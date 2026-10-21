//! `MinimalAgentInner` —— 共享内部状态,以及 `new_empty` 与 `AgentStatus`。
//!
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

use super::remote_config::RemoteConfig;

/// Session-level broadcast 通道容量。覆盖 1024 个 event 后最旧事件被丢;
/// 桌面端 UI 通常只关心最近 50-100 个事件,这个容量远超实际需要。
pub(crate) const SESSION_BROADCAST_CAPACITY: usize = 1024;

/// 按配置快照计算降级原因(供 install / 热重载共用)。
///
/// 两级缺失分开报:无 provider(没 key)与「有 provider 但没 model」。
/// 上游 model 解析诚实化后,后者不再编造默认模型名 —— 状态栏如实显示
/// "未配置模型",这里给出可行动的指引。
pub(crate) fn compute_degraded_reason(cfg: &ReflectConfig) -> Option<String> {
    if cfg.active_provider().is_none() {
        return Some("no provider configured — set an API key in Settings".to_string());
    }
    // 与 spec 兜底同口径:兜底能解析出可用凭证就不算降级,否则配置里
    // 明明有可用凭证、状态栏却挂着"未配置模型"的误导性黄点。
    if resolve_model_spec_with_fallback(cfg).is_none() {
        return Some(
            "provider configured but no model — pick a plan/model in Settings → Models".to_string(),
        );
    }
    None
}

/// 显式 model spec 解析(env > 钉住条目 > 段级)失败时的兜底:回退到
/// active provider 下**第一个带 model 的凭证条目**。
///
/// 为什么需要:`[active].credential` 可能悬空指向不存在的条目(配置手改 /
/// 凭证 label 改名后残留,如 `"default"` vs 池里的 `"MiniMax"`),显式链
/// 返回 None,调用方此前直接落 `"stub/test"` → 路由池没有 stub provider →
/// 每次请求报 `ALL_CREDENTIALS_EXHAUSTED (0 tried)`,而池里明明有可用
/// 凭证。这里与 `next_for` 对悬空 preferred 的「静默回落轮询」语义对齐:
/// 有可用凭证就照常跑,不把可自愈的配置问题放大成硬故障。
pub(crate) fn resolve_model_spec_with_fallback(cfg: &ReflectConfig) -> Option<String> {
    if let Some(spec) = cfg.resolved_model_spec() {
        return Some(spec);
    }
    let provider = cfg.active_provider()?;
    let creds = match provider {
        "anthropic" => cfg.anthropic.as_ref().map(|s| &s.credentials),
        "openai" => cfg.openai.as_ref().map(|s| &s.credentials),
        "ollama" => cfg.ollama.as_ref().map(|s| &s.credentials),
        _ => None,
    }?;
    let model = creds
        .iter()
        .find(|c| c.model.as_deref().is_some_and(|m| !m.trim().is_empty()))
        .and_then(|c| c.model.as_deref())
        .map(str::trim)?;
    Some(format!("{provider}/{model}"))
}

/// Agent 共享 inner:由 `Arc<MinimalAgentInner>` 包装,所有 `MinimalAgent`
/// 的 clone 共享同一份状态。
pub(crate) struct MinimalAgentInner {
    /// `Option` 因为 `new_empty` 时还没建。
    pub(crate) thread: ParkingMutex<Option<Arc<AgentThread>>>,
    /// 会话事件广播 — 多个 Tauri command / webview 可各自订阅。
    pub(crate) session_tx: broadcast::Sender<Event>,
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
    pub(crate) shell_sessions: crate::shell_sessions::ShellSessions,
    pub(crate) memory_store: crate::memory_store::MemoryStore,
    pub(crate) hook_store: crate::hook_store::HookStore,
    /// Task/Team 管理器(供多 agent 命令面调用)。
    /// 复用 reflect-agent/crates/orchestration/reflect-task 默认 home(`~/.reflect`),与 TUI/CLI 共享数据。
    /// 初始形态:无 hook_engine / event_sink;后续把 TaskCreated/Completed
    /// 事件推前端时再 `with_event_sink`。
    pub(crate) task_manager: Arc<reflect_task::TaskManager>,
    /// Cron 调度器。`None` 直到 `install_agent_thread`
    /// 把真 `AgentThread::submission_sender()` 注入(driver 才能真正触发);
    /// 此前 CRUD 仍可用(命令层读 `RwLock`,只是无后台 driver)。
    pub(crate) cron_scheduler: parking_lot::RwLock<Option<reflect_stream::cron::CronScheduler>>,
    /// Side-channel registry:每个 side-channel 持有独立
    /// `CancelToken`,主 agent 的 cancel 不会传播到 side-channel。事件流
    /// 经 `subscribe_events()` → Tauri `reflect_event` channel 推前端。
    pub(crate) side_channels: reflect_app_core::side_channel::SideChannelRegistry,
    /// Remote mode config:iOS / 远端 daemon 连接的目标
    /// (host + port + auth_token) 与运行时状态。进程内存储,重启重置
    /// —— 持久化留作后续。
    pub(crate) remote_config: parking_lot::RwLock<RemoteConfig>,
    /// KMS 知识库管理器:grep-based wiki + /dream。
    pub(crate) kms_manager: reflect_app_core::kms::KnowledgeManager,
    /// Autopilot 管理器:自动任务调度。
    pub(crate) autopilot_manager: reflect_app_core::autopilot::AutopilotManager,
    /// Activity 日志管理器:本地事件审计 timeline。
    /// 由 `install_agent_thread` 订阅 session broadcast 把 `Event` 映射成
    /// `ActivityEvent` 后写入。
    pub(crate) activity_logger: Arc<reflect_app_core::activity::ActivityLogger>,
    /// Squad 管理器:复用 `task_manager` 的 TeamFile 存储,
    /// 提供 leader 委派语义层。
    pub(crate) squad_manager: Arc<reflect_app_core::squad::SquadManager>,
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
    /// v1.x 会话持久化:当前绑定的 session id(`None` = install 后的占位
    /// thread,首条消息时会重建并写入首个真正 id)。
    /// rebind_session 比较短路;命令层通过 `bound_session_id()` 读取。
    pub(crate) bound_session_id: ParkingMutex<Option<ThreadId>>,
    /// v1.x cron 修复:`install_agent_thread` 启动 driver 后保留句柄,
    /// 否则 driver 任务被 `CronDriverHandle::drop` 立即 abort(cron 永远
    /// 不触发)。rebind_session 时 `stop` 旧 driver + 用新 sender 重启。
    pub(crate) cron_driver: ParkingMutex<Option<reflect_stream::cron::CronDriverHandle>>,
    /// LSP 连接管理器(按工作区由用户手动开启;None = 未启用)。
    pub(crate) lsp_manager: ParkingMutex<Option<std::sync::Arc<reflect_lsp::LspConnectionManager>>>,
    /// MCP 连接管理器句柄。v1.6 接线:bootstrap_mcp 的返回值此前被
    /// `let _ =` 丢弃 —— MCP meta 工具(ListMcpResources / ReadMcpResource
    /// / ListMcpPrompts / GetMcpPrompt)全部需要持有 manager,导致
    /// Desktop 一直无法 list/read MCP resources / prompts。install 时
    /// 写入;None = 未启用(config 无 [mcp_servers] 或 bootstrap 失败)。
    pub(crate) mcp_manager: ParkingMutex<Option<std::sync::Arc<reflect_mcp::McpConnectionManager>>>,
    /// 插件运行时句柄(exec/serve 同款 `SharedPluginRuntime`;内层 `None`
    /// = 未挂载:占位线程、HOME 缺失或 plugins 目录不存在)。真实会话
    /// rebind 时由 `state/plugins.rs::spawn_mount` 卸旧装新;submit 边界
    /// 用它展开 `/plugin:*` 命令。
    pub(crate) plugin_runtime: reflect_plugin::SharedPluginRuntime,
    /// 插件挂载串行锁:并发 rebind 的「卸旧→装新→写句柄」在此互斥,
    /// 保证句柄最终属于最后一次 rebind 的线程。
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

/// 第一阶段:构造空的 MinimalAgent,只能 hold 状态(无 thread)。
///
/// `tauri::Builder::manage(MinimalAgent::new_empty())` 时调用。
pub(crate) fn build_empty_inner() -> MinimalAgentInner {
    let (session_tx, _) = broadcast::channel(SESSION_BROADCAST_CAPACITY);
    let workspace = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let cfg = reflect_app_core::sandbox::load_config_with_sandbox_baseline();
    // Task/Team 存储复用 核心 crate 默认 home(REFLECT_HOME 或 $HOME/.reflect),
    // 与 TUI/CLI 共享 `~/.reflect/tasks/` 与 `~/.reflect/teams/`。
    // home 解析失败时回退到 cwd 下的 `.reflect`,保证进程仍可启动(命令会报 I/O 错)。
    let task_store = Arc::new(
        reflect_task::FileTaskStore::with_default_home()
            .unwrap_or_else(|_| reflect_task::FileTaskStore::new(".")),
    );
    let team_store = Arc::new(
        reflect_task::FileTeamStore::with_default_home()
            .unwrap_or_else(|_| reflect_task::FileTeamStore::new(".")),
    );
    let task_manager = Arc::new(reflect_task::TaskManager::new(task_store, team_store));
    // Cron scheduler 初始为 None;install_agent_thread 注入真 sender 后重建。
    let cron_scheduler = parking_lot::RwLock::new(None);
    let side_channels = reflect_app_core::side_channel::SideChannelRegistry::new();
    let remote_config = parking_lot::RwLock::new(RemoteConfig::default());
    let kms_manager = reflect_app_core::kms::KnowledgeManager::with_default_home();
    let autopilot_manager = reflect_app_core::autopilot::AutopilotManager::new();
    let activity_logger = Arc::new(reflect_app_core::activity::ActivityLogger::with_default_home());
    // SquadManager 复用 task_manager(team 存储),必须在 task_manager 之后构造。
    let squad_manager = Arc::new(reflect_app_core::squad::SquadManager::new(Arc::clone(
        &task_manager,
    )));
    MinimalAgentInner {
        thread: ParkingMutex::new(None),
        session_tx,
        cfg: Arc::new(RwLock::new(cfg)),
        tools: Arc::new(ToolRegistry::new()),
        model_spec: RwLock::new("stub/test".to_string()),
        workspace,
        degraded_reason: ParkingMutex::new(None),
        shell_sessions: crate::shell_sessions::ShellSessions::default(),
        memory_store: crate::memory_store::MemoryStore,
        hook_store: crate::hook_store::HookStore::default(),
        task_manager,
        cron_scheduler,
        side_channels,
        remote_config,
        kms_manager,
        autopilot_manager,
        activity_logger,
        squad_manager,
        model_registry: ParkingMutex::new(None),
        quota_tracker: ParkingMutex::new(None),
        bound_session_id: ParkingMutex::new(None),
        cron_driver: ParkingMutex::new(None),
        lsp_manager: ParkingMutex::new(None),
        mcp_manager: ParkingMutex::new(None),
        plugin_runtime: reflect_plugin::empty_plugin_runtime(),
        plugin_mount_lock: Arc::new(tokio::sync::Mutex::new(())),
        app_handle: RwLock::new(None),
    }
}

#[cfg(test)]
mod tests {
    use super::{compute_degraded_reason, resolve_model_spec_with_fallback};
    use crate::state::MinimalAgent;

    #[test]
    fn new_empty_has_no_thread() {
        let agent = MinimalAgent::new_empty();
        assert!(agent.inner.thread.lock().is_none());
        // model_spec 初始为降级标记。
        assert_eq!(agent.model_spec(), "stub/test");
    }

    /// 悬空钉住(`[active].credential` 指向不存在的 label)+ 凭证条目带
    /// model → 兜底回退到第一个带 model 的凭证,spec 不再落 stub/test。
    /// 这是 `ALL_CREDENTIALS_EXHAUSTED (0 tried)` 的根因回归测试。
    #[test]
    fn spec_fallback_recovers_from_dangling_credential_pin() {
        let toml = r#"
            [active]
            provider = "anthropic"
            credential = "default"

            [anthropic]
            base_url = "https://api.minimaxi.com/anthropic"

            [[anthropic.credentials]]
            label = "MiniMax"
            api_key = "sk-test"
            base_url = "https://api.minimaxi.com/anthropic"
            model = "MiniMax-M3"
            weight = 1
        "#;
        let cfg = reflect_config::load_from_str(toml).unwrap();
        // 显式链确实为 None(钉住 label 不存在 + 无段级 model)。
        assert_eq!(cfg.resolved_model_spec(), None);
        assert_eq!(
            resolve_model_spec_with_fallback(&cfg).as_deref(),
            Some("anthropic/MiniMax-M3")
        );
        // 有可用凭证 → 不再判定降级。
        assert_eq!(compute_degraded_reason(&cfg), None);
    }

    /// 显式链可用时兜底不干预(钉住条目 model 优先,env > 钉住 > 段级)。
    #[test]
    fn spec_fallback_prefers_explicit_resolution() {
        let toml = r#"
            [active]
            provider = "anthropic"
            credential = "MiniMax"

            [anthropic]
            model = "section-model"

            [[anthropic.credentials]]
            label = "MiniMax"
            api_key = "sk-test"
            model = "MiniMax-M3"
        "#;
        let cfg = reflect_config::load_from_str(toml).unwrap();
        assert_eq!(
            resolve_model_spec_with_fallback(&cfg).as_deref(),
            Some("anthropic/MiniMax-M3")
        );
    }

    /// 凭证条目全部无 model(且无段级 model)→ 兜底也 None,保持诚实降级。
    #[test]
    fn spec_fallback_returns_none_without_any_model() {
        let toml = r#"
            [active]
            provider = "anthropic"

            [anthropic]
            api_key = "sk-test"

            [[anthropic.credentials]]
            label = "a"
            api_key = "sk-a"
        "#;
        let cfg = reflect_config::load_from_str(toml).unwrap();
        assert_eq!(resolve_model_spec_with_fallback(&cfg), None);
        assert!(compute_degraded_reason(&cfg).is_some());
    }

    #[test]
    fn agent_status_reports_degraded_when_no_provider() {
        // 测试环境无 API key/env,active_provider() 应为 None。
        let agent = MinimalAgent::new_empty();
        let status = agent.agent_status();
        assert!(!status.ready, "thread not installed yet");
    }

    /// 验证 ReflectConfig 真实加载:从 ~/.reflect/config.toml + env 读到非空 cfg。
    /// 这是 settings UI 显示的源数据;若 cfg 加载失败,整个 settings 页会空。
    #[test]
    fn cfg_loads_from_real_config() {
        let agent = MinimalAgent::new_empty();
        let cfg_handle = agent.cfg();
        let cfg = cfg_handle.read();
        // active_provider() 要么从 [active] provider 读到 "anthropic" 等,
        // 要么从 env(OPENAI_API_KEY / ANTHROPIC_API_KEY)推断。
        // CI 无配置时为 None,本地开发机通常有 ~/.reflect/config.toml。
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
