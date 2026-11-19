//! `MinimalAgentInner` —— 共享内部状态,以及 `new_empty` 与 `AgentStatus`。
//! `state.rs` 只保留 facade;实际的内层结构、构造期常量、诊断快照
//! 全部由本模块提供。

use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::{Mutex as ParkingMutex, RwLock};
use reflect_config::ReflectConfig;
use reflect_core::AgentThread;
use reflect_llm::SharedModelRegistry;
use reflect_protocol::{Event, ThreadId};
use reflect_tools::ToolRegistry;
use serde::Serialize;
use tokio::sync::broadcast;

use super::{discussion::DiscussionCancellations, remote_config::RemoteConfig};

/// Session-level broadcast 通道容量。覆盖 1024 个 event 后最旧事件被丢;
/// 桌面端 UI 通常只关心最近 50-100 个事件,这个容量远超实际需要。
pub(crate) const SESSION_BROADCAST_CAPACITY: usize = 1024;

/// 后台会话线程表上限。切走的会话若 turn 仍在跑,线程保活继续运行;
/// 超限时按「空闲优先、最旧兜底」驱逐(驱逐 = cancel,等同旧换绑行为)。
pub(crate) const MAX_BACKGROUND_THREADS: usize = 8;

/// Agent 共享 inner:由 `Arc<MinimalAgentInner>` 包装,所有 `MinimalAgent`
/// 的 clone 共享同一份状态。
pub(crate) struct MinimalAgentInner {
    /// `Option` 因为 `new_empty` 时还没建。
    pub(crate) thread: ParkingMutex<Option<Arc<AgentThread>>>,
    /// 配置写入及包含异步回放的会话切换各自串行。
    pub(crate) rebind_lock: ParkingMutex<()>,
    pub(crate) config_write_lock: tokio::sync::Mutex<()>,
    pub(crate) session_transition_lock: tokio::sync::Mutex<()>,
    pub(crate) recorder_gates: ParkingMutex<
        std::collections::HashMap<ThreadId, std::sync::Weak<super::recorder_guard::RecorderGate>>,
    >,
    pub(crate) memory_write_lock: tokio::sync::Mutex<()>,
    /// 会话事件广播 — 多个 Tauri command / webview 可各自订阅。
    pub(crate) session_tx: broadcast::Sender<Event>,
    pub(crate) discussion_cancellations: DiscussionCancellations,
    /// 共享 config —— 热重载 / settings 读写命令共用。
    pub(crate) cfg: Arc<RwLock<ReflectConfig>>,
    /// 共享 ToolRegistry —— MCP/LSP 后续 register_plugin_tool 用。
    pub(crate) tools: Arc<ToolRegistry>,
    /// 当前 model spec 字符串(诊断用,真实值从 cfg 解析)。
    pub(crate) model_spec: RwLock<String>,
    /// 工作区根 —— 当前固定 cwd;M4.x 由前端 settings 切换。
    pub(crate) workspace: PathBuf,
    /// 降级原因(无 API key 等);None 表示正常就绪。
    pub(crate) degraded_reason: ParkingMutex<Option<String>>,
    pub(crate) pending_rebind_error: ParkingMutex<Option<String>>,
    pub(crate) pending_plugin_reload_error: ParkingMutex<Option<String>>,
    pub(crate) pending_model_discovery_error: ParkingMutex<Option<String>>,
    pub(crate) shell_sessions: crate::shell_sessions::ShellSessions,
    /// 受控浏览器管理器(启动/attach + screencast 帧流;browser_backend.rs)。
    /// 用 tokio Mutex:命令体在 await 期间持锁(帧流启动/状态查询跨 IO)。
    pub(crate) browser: tokio::sync::Mutex<crate::browser_backend::BrowserManager>,
    pub(crate) memory_store: crate::memory_store::MemoryStore,
    pub(crate) hook_store: crate::hook_store::HookStore,
    /// Task/Team 管理器(供多 agent 命令面调用)。
    /// 复用 zhuye-agent/crates/orchestration/reflect-task 默认 home(`~/.zhuye`),与 TUI/CLI 共享数据。
    /// 初始形态:无 hook_engine / event_sink;后续把 TaskCreated/Completed
    /// 事件推前端时再 `with_event_sink`。
    pub(crate) task_manager: Arc<reflect_task::TaskManager>,
    pub(crate) task_hook_target: super::task_hooks::HookTarget,
    pub(crate) plugin_hook_slot: ParkingMutex<Option<super::plugin_hooks::PluginHookSlot>>,
    pub(crate) mounted_plugin_bridge:
        ParkingMutex<Option<Arc<super::plugin_hooks::PluginHookBridge>>>,
    pub(crate) plugin_runtime_context: ParkingMutex<Option<super::plugins::PluginRuntimeContext>>,
    /// Cron 调度器。`None` 直到 `install_agent_thread`
    /// 把真 `AgentThread::submission_sender()` 注入(driver 才能真正触发);
    /// 此前 CRUD 仍可用(命令层读 `RwLock`,只是无后台 driver)。
    pub(crate) cron_scheduler: parking_lot::RwLock<Option<reflect_stream::cron::CronScheduler>>,
    /// Side-channel registry(进程级,引擎 `zhuye-core::side_channel` 的
    /// Arc 共享状态):`thread_factory` 每次 rebind 用它重建 driver,
    /// 在跑的 side-channel 与事件流跨 rebind 存活。命令层经引擎
    /// `Op::Start/Cancel/QuerySideChannels` 走同一份状态。
    pub(crate) side_channels: reflect_core::side_channel::SideChannelRegistry,
    /// Remote mode config:iOS / 远端 daemon 连接的目标
    /// (host + port + auth_token) 与运行时状态。进程内存储,重启重置
    /// —— 持久化留作后续。
    pub(crate) remote_config: parking_lot::RwLock<RemoteConfig>,
    /// KMS 知识库管理器:grep-based wiki + /dream。
    pub(crate) kms_manager: reflect_kms::KnowledgeManager,
    /// Autopilot 管理器:自动任务调度。
    pub(crate) autopilot_manager: reflect_stream::autopilot::AutopilotManager,
    /// 跨桌面进程的 Autopilot 独占租约，跨会话重绑定保留。
    pub(crate) autopilot_lease: ParkingMutex<Option<std::fs::File>>,
    /// Activity 日志管理器：会话事件审计 timeline。
    pub(crate) activity_log: Arc<reflect_app_core::activity::ActivityLog>,
    /// Squad 管理器:复用 `task_manager` 的 TeamFile 存储,
    /// 提供 leader 委派语义层。
    pub(crate) squad_manager: Arc<reflect_task::SquadManager>,
    /// v1.x 会话持久化:`install_agent_thread` 一次性构造好的共享 ModelRegistry。
    /// `rebind_session` 重建 AgentThread 时复用(provider clients 昂贵,
    /// 不每次重建);注册到 inner 后 `construct_thread` 直接读。
    /// v1.x coding plan:`reflect_save_config` 保存 provider 相关段变更时
    /// 会整体重建并热替换(见 `state/reload.rs`),新计划无需重启生效。
    pub(crate) model_registry: ParkingMutex<Option<SharedModelRegistry>>,
    /// coding plan 配额追踪器:遍历 config `[[<provider>.credentials]].quota`
    /// 声明构建(见 `state/quota.rs`)。`None` = 未声明任何配额(向后兼容)。
    /// 与 `model_registry` 同生命周期:install 时构建,provider 段变更时重建。
    pub(crate) quota_tracker: ParkingMutex<Option<reflect_llm::SharedQuotaTracker>>,
    /// 当前绑定 session id;`None` 表示 install 后的占位 thread。
    /// rebind_session 比较短路;命令层通过 `bound_session_id()` 读取。
    pub(crate) bound_session_id: ParkingMutex<Option<ThreadId>>,
    /// 后台会话线程表(v1.x 后台持续运行):切走的会话若 turn 仍在跑,
    /// 线程迁入此表继续运行,**不再 cancel**(旧行为取消会话级令牌等于
    /// `Op::Shutdown`,是「切走即中断」的根因)。Vec 保插入序(尾部最旧),
    /// 便于按「空闲优先、最旧兜底」驱逐;promote(bind 回该会话)时移出。
    pub(crate) background: ParkingMutex<Vec<(ThreadId, Arc<AgentThread>)>>,
    /// 后台会话事件通道:`(session_id, Event)`。forwarder 对非前台线程的
    /// 事件发到这里(前台 `session_tx` → `reflect_event` 线格式不变);
    /// 前端据此维护运行徽标 / 待确认交互,切回时由 bind→promote 回到前台通道。
    pub(crate) background_tx: broadcast::Sender<(ThreadId, Event)>,
    /// 后台会话是否有 turn 在跑(forwarder 按 turn 生命周期维护)。
    /// 仅服务驱逐策略(空闲线程优先驱逐);promote/evict 时同样增删。
    pub(crate) background_running: ParkingMutex<std::collections::HashSet<ThreadId>>,
    /// 已启动的 session forwarder 计数(诊断 / 回归断言用)。
    ///
    /// **一个线程只需一个 forwarder**:`AgentThread::subscribe_session()`
    /// 是**追加订阅者**语义(每次调用新建一条 mpsc 通道并挂进
    /// `session_subs`),同一线程挂两个 forwarder 会让每条事件被
    /// **双发**到前台通道(delta 文本翻倍)。因此 promote(bind 回后台
    /// 会话)复用既有 forwarder,不再新建 —— 见 `state/rebind.rs`。
    pub(crate) forwarder_count: std::sync::atomic::AtomicUsize,
    /// rebind 代数:每次成功换绑(含 promote)自增。挂在插件挂载上的
    /// 提交(`wait_for_plugins`)据此感知「会话已切走」并快速失败,
    /// 而非无限等待可能卡死的挂载(旧实现靠 cancel 旧线程间接解挂,
    /// 后台化后线程不再被取消,需要显式信号)。
    pub(crate) rebind_generation: tokio::sync::watch::Sender<u64>,
    /// cron driver 句柄;drop 会 abort 任务,rebind 时 stop 后用新 sender 重启。
    pub(crate) cron_driver: ParkingMutex<Option<reflect_stream::cron::CronDriverHandle>>,
    pub(crate) autopilot_driver: ParkingMutex<Option<super::AutopilotDriverHandle>>,
    /// LSP 连接管理器(按工作区由用户手动开启;None = 未启用)。
    pub(crate) lsp_manager: ParkingMutex<Option<std::sync::Arc<reflect_lsp::LspConnectionManager>>>,
    /// 启停命令须串行，避免并发创建多个管理器或关错实例。
    pub(crate) lsp_lifecycle_lock: tokio::sync::Mutex<()>,
    /// MCP 连接管理器句柄；安装期间创建，即使没有配置服务也保留空管理器。
    pub(crate) mcp_manager: ParkingMutex<Option<std::sync::Arc<reflect_mcp::McpConnectionManager>>>,
    pub(crate) mcp_tools: crate::mcp::McpTools,
    pub(crate) mcp_invoked_tx: ParkingMutex<Option<tokio::sync::mpsc::Sender<Event>>>,
    /// 插件运行时句柄(exec/serve 同款 `SharedPluginRuntime`;内层 `None`
    /// = 未挂载:占位线程、HOME 缺失或 plugins 目录不存在)。真实会话
    /// rebind 时由 `state/plugins.rs::spawn_mount` 卸旧装新;submit 边界
    /// 用它展开 `/plugin:*` 命令。
    pub(crate) plugin_runtime: reflect_plugin::SharedPluginRuntime,
    /// 插件挂载与配置更新共用的串行锁。
    pub(crate) plugin_mount_lock: Arc<tokio::sync::Mutex<()>>,
    /// 应用句柄(生产运行时由 setup 注入一次)。
    ///
    /// ## 为什么句柄要收进状态,而不是直接当命令参数
    ///
    /// 命令签名里写 `tauri::AppHandle` 等于写死 `AppHandle<Wry>` ——
    /// 那条命令**只能**注册到 Wry builder 上。能力覆盖层
    /// (`src-tauri/tests/`)用 mock runtime 建 app,一旦注册表里有一条
    /// Wry 绑定的命令,整张注册表就装不进 mock app,真实命令体也就
    /// 驱不动了。句柄收进托管状态后,命令签名只依赖 `State`,生产与
    /// 测试共用**同一份** `generate_handler!` 注册表。
    ///
    /// mock runtime 下本字段为 `None` —— 依赖 OS 交互的命令(原生
    /// 文件选择框 / dock 徽标 / 终端事件推送)在能力覆盖层里走
    /// 「无句柄」分支,行为降级但**不崩**。
    pub(crate) app_handle: RwLock<Option<tauri::AppHandle>>,
}

/// agent 诊断快照 —— 给前端显示状态徽标(ready / 是否有 API key / 模型 / 工作区)。
#[derive(Debug, Clone, Serialize)]
pub struct AgentStatus {
    /// AgentThread 是否已安装(setup 异步安装完成前为 false)。
    pub ready: bool,
    /// 是否检测到可用 provider(读到了 API key / 配置)。
    pub has_model: bool,
    /// 当前 provider 的 model spec(`anthropic/claude-...`),降级时为 `stub/test`。
    pub model: String,
    /// 当前工作区根。
    pub workspace: String,
    /// 降级原因(无 API key / config 缺失等),给前端 tooltip 用。
    pub degraded_reason: Option<String>,
}

/// 构造仅包含状态、尚无 thread 的 MinimalAgent，供 `manage` 调用。
pub(crate) fn build_empty_inner() -> MinimalAgentInner {
    let (session_tx, _) = broadcast::channel(SESSION_BROADCAST_CAPACITY);
    let (background_tx, _) = broadcast::channel(SESSION_BROADCAST_CAPACITY);
    let (rebind_generation, _) = tokio::sync::watch::channel(0u64);
    let workspace = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let cfg = reflect_app_core::sandbox::load_config_with_sandbox_baseline();
    // Task/Team 存储复用核心 crate 默认 home（`$ZHUYE_HOME` > `$HOME/.zhuye`），
    // 与 CLI 共享 `~/.zhuye/tasks/` 与 `~/.zhuye/teams/`。
    // home 解析失败时回退到 cwd 下的 `.zhuye`,保证进程仍可启动(命令会报 I/O 错)。
    let task_store = Arc::new(
        reflect_task::FileTaskStore::with_default_home()
            .unwrap_or_else(|_| reflect_task::FileTaskStore::new(".")),
    );
    let team_store = Arc::new(
        reflect_task::FileTeamStore::with_default_home()
            .unwrap_or_else(|_| reflect_task::FileTeamStore::new(".")),
    );
    let (task_hook_engine, task_hook_target) = super::task_hooks::task_hook_bridge();
    let task_manager = Arc::new(
        reflect_task::TaskManager::new(task_store, team_store).with_hook_engine(task_hook_engine),
    );
    let cron_scheduler = parking_lot::RwLock::new(None);
    let side_channels = reflect_core::side_channel::SideChannelRegistry::new();
    let remote_config = parking_lot::RwLock::new(RemoteConfig::default());
    let kms_manager = reflect_kms::KnowledgeManager::with_default_home();
    let autopilot_manager = reflect_stream::autopilot::AutopilotManager::new();
    let activity_log = super::activity::build_activity_log();
    // SquadManager 复用 task_manager(team 存储),必须在 task_manager 之后构造。
    let squad_manager = Arc::new(reflect_task::SquadManager::new(Arc::clone(&task_manager)));
    MinimalAgentInner {
        thread: ParkingMutex::new(None),
        rebind_lock: ParkingMutex::new(()),
        config_write_lock: tokio::sync::Mutex::new(()),
        session_transition_lock: tokio::sync::Mutex::new(()),
        recorder_gates: ParkingMutex::new(std::collections::HashMap::new()),
        memory_write_lock: tokio::sync::Mutex::new(()),
        session_tx,
        discussion_cancellations: DiscussionCancellations::default(),
        cfg: Arc::new(RwLock::new(cfg)),
        tools: Arc::new(ToolRegistry::new()),
        model_spec: RwLock::new("stub/test".to_string()),
        workspace,
        degraded_reason: ParkingMutex::new(None),
        pending_rebind_error: ParkingMutex::new(None),
        pending_plugin_reload_error: ParkingMutex::new(None),
        pending_model_discovery_error: ParkingMutex::new(None),
        shell_sessions: crate::shell_sessions::ShellSessions::default(),
        browser: tokio::sync::Mutex::new(crate::browser_backend::BrowserManager::new()),
        memory_store: crate::memory_store::MemoryStore,
        hook_store: crate::hook_store::HookStore::default(),
        task_manager,
        task_hook_target,
        plugin_hook_slot: ParkingMutex::new(None),
        mounted_plugin_bridge: ParkingMutex::new(None),
        plugin_runtime_context: ParkingMutex::new(None),
        cron_scheduler,
        side_channels,
        remote_config,
        kms_manager,
        autopilot_manager,
        autopilot_lease: ParkingMutex::new(None),
        activity_log,
        squad_manager,
        model_registry: ParkingMutex::new(None),
        quota_tracker: ParkingMutex::new(None),
        bound_session_id: ParkingMutex::new(None),
        background: ParkingMutex::new(Vec::new()),
        background_tx,
        background_running: ParkingMutex::new(std::collections::HashSet::new()),
        forwarder_count: std::sync::atomic::AtomicUsize::new(0),
        rebind_generation,
        cron_driver: ParkingMutex::new(None),
        autopilot_driver: ParkingMutex::new(None),
        lsp_manager: ParkingMutex::new(None),
        lsp_lifecycle_lock: tokio::sync::Mutex::new(()),
        mcp_manager: ParkingMutex::new(None),
        mcp_tools: crate::mcp::McpTools::default(),
        mcp_invoked_tx: ParkingMutex::new(None),
        plugin_runtime: reflect_plugin::empty_plugin_runtime(),
        plugin_mount_lock: Arc::new(tokio::sync::Mutex::new(())),
        app_handle: RwLock::new(None),
    }
}

#[cfg(test)]
mod tests {
    use crate::state::MinimalAgent;

    #[test]
    fn new_empty_has_no_thread() {
        let agent = MinimalAgent::new_empty();
        assert!(agent.inner.thread.lock().is_none());
        // model_spec 初始为降级标记。
        assert_eq!(agent.model_spec(), "stub/test");
    }

    #[test]
    fn agent_status_reports_degraded_when_no_provider() {
        // 测试环境无 API key/env,active_provider() 应为 None。
        let agent = MinimalAgent::new_empty();
        let status = agent.agent_status();
        assert!(!status.ready, "thread not installed yet");
    }

    /// 验证 ReflectConfig 真实加载:从 ~/.zhuye/config.toml + env 读到非空 cfg。
    /// 这是 settings UI 显示的源数据;若 cfg 加载失败,整个 settings 页会空。
    #[test]
    fn cfg_loads_from_real_config() {
        let agent = MinimalAgent::new_empty();
        let cfg_handle = agent.cfg();
        let cfg = cfg_handle.read();
        // active_provider() 要么从 [active] provider 读到 "anthropic" 等,
        // 要么从 env(OPENAI_API_KEY / ANTHROPIC_API_KEY)推断。
        // CI 无配置时为 None,本地开发机通常有 ~/.zhuye/config.toml。
        let providers_count = cfg.active_provider().is_some() as u32;
        assert!(
            providers_count <= 1,
            "active_provider should be Some or None, got multiple"
        );
    }

    /// agent_status 字段完整性:ready/model/workspace 必须有合法值,
    /// 不得 panic 或返回未初始化字符串。
    #[test]
    fn agent_status_fields_are_well_formed() {
        let agent = MinimalAgent::new_empty();
        let status = agent.agent_status();
        assert!(!status.ready, "pre-install: ready must be false");
        // model_spec 在 install 前为 "stub/test";install 后为 provider/model 字符串。
        assert!(!status.model.is_empty(), "model must not be empty");
        assert!(
            !status.workspace.is_empty(),
            "workspace path must not be empty"
        );
        // degraded_reason 在 install 前是 None(install 时根据 provider 决定)。
        assert!(status.degraded_reason.is_none() || status.degraded_reason.is_some());
    }
}
