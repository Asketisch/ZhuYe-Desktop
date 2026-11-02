//! `AppState` —— 真后端 facade:嵌入 `reflect_core::AgentThread`,接真实 LLM
//! provider 与内置工具集。
//!
//! 真正的实现位于 [`state::agent`] / [`state::install`] / [`state::session`] /
//! [`state::submit`];本文件只暴露 `MinimalAgent` 顶壳与 thin 委托方法。
//!
//! ## 公开 API
//!
//! `new_empty` / `install_agent_thread` / `submit` / `submit_op` /
//! `subscribe_session` / `session_tx` / `interrupt` / `model_spec` /
//! `workspace` / `agent_status` / `cfg` / `tools` / domain APIs。
//! `commands/mod.rs` 与 `lib.rs` 不需要改协议面(Submission/Event 形态不变)。

use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::RwLock;
use reflect_config::ReflectConfig;
use reflect_protocol::Event;
use reflect_tools::ToolRegistry;
use tokio::sync::broadcast;

pub use remote_config::{RemoteConfig, RemoteStatus};

mod activity;
mod agent;
mod install;
pub(crate) mod permissions;
pub(crate) mod plugin_hooks;
pub(crate) mod plugin_status;
pub(crate) mod plugins;
pub(crate) mod quota;
pub(crate) mod rebind;
pub(crate) mod recorder_guard;
pub(crate) mod reload;
mod remote_config;
pub(crate) mod sandbox;
mod session;
pub(crate) mod subagents;
mod submit;
mod task_hooks;
mod thread_factory;

pub use agent::AgentStatus;

/// 主结构:封装一个 `AgentThread` + session 级 broadcast + 共享 config/tools。
///
/// Clone 是廉价的(内部全 Arc/broadcast channel)。二段构造:`new_empty()` 在
/// `tauri::Builder::manage` 同步阶段调用,`install_agent_thread()` 在 setup
/// 内的 async runtime 上下文里调用。
#[derive(Clone)]
pub struct MinimalAgent {
    pub(crate) inner: Arc<agent::MinimalAgentInner>,
}

impl MinimalAgent {
    /// 第一阶段:构造空的 MinimalAgent,只能 hold 状态(无 thread)。
    pub fn new_empty() -> Self {
        Self {
            inner: Arc::new(agent::build_empty_inner()),
        }
    }

    /// 第二阶段:在 Tauri setup 闭包内调用,真构造 AgentThread + 启动 forwarder。
    ///
    /// `async`:model spec 的解析可能要打 provider 的模型清单端点
    /// (`model = "free"` 这类动态值),那是网络 I/O。
    pub async fn install_agent_thread(&self) {
        install::install_agent_thread(self).await;
    }

    /// 注入应用句柄(生产 setup 调用一次)。
    ///
    /// 命令层需要它做 OS 交互(原生对话框 / dock 徽标 / 终端事件推送),
    /// 但命令签名不能直接收 `AppHandle` —— 那样命令就与 runtime 绑死,
    /// 能力覆盖层(mock runtime)驱不动真实命令体。详见
    /// [`state::agent::MinimalAgentInner::app_handle`]。
    pub fn set_app_handle(&self, handle: tauri::AppHandle) {
        *self.inner.app_handle.write() = Some(handle);
    }

    /// 取应用句柄;`None` = 未注入(mock runtime / 尚未 setup)。
    pub fn app_handle(&self) -> Option<tauri::AppHandle> {
        self.inner.app_handle.read().clone()
    }

    /// 提交 Submission → 拿 per-turn `TurnHandle` → spawn 转发到 broadcast。
    pub async fn submit(&self, submission: reflect_protocol::Submission) -> anyhow::Result<()> {
        submit::submit(self, submission).await
    }

    /// 投递一个非 `UserInput` 的 `Op`(compact / rewind / approval / plan / effort /
    /// permission / ask_user 等)。自动生成 submission id。
    pub async fn submit_op(&self, op: reflect_protocol::Op) -> anyhow::Result<String> {
        submit::submit_op(self, op).await
    }

    /// 订阅 session 级 broadcast。前端 Tauri listener 拿到的就是这个 receiver。
    pub fn subscribe_session(&self) -> broadcast::Receiver<Event> {
        session::subscribe_session(self)
    }

    /// 会话广播发送方句柄（MCP/LSP 生命周期事件反向推送用）。
    pub fn session_tx(&self) -> broadcast::Sender<Event> {
        session::session_tx(self)
    }

    /// 中断**当前回合** —— 提交 `Op::Interrupt`(回合粒度)。
    ///
    /// ⚠️ 不要直接取消 `AgentThread::cancel_token()`:那是**会话级**令牌,
    /// 取消它等于 `Op::Shutdown` —— 会话就此报废,后续每次提交都被立刻
    /// 取消。核心的 `Op::Interrupt` 只取消**在飞回合**的令牌。
    pub async fn interrupt(&self) -> anyhow::Result<String> {
        submit::interrupt(self).await
    }

    /// 返回当前 AgentThread 的 cancel token(`install_agent_thread` 之前为 None)。
    /// 暴露给测试代码断言 cancel 状态 —— submodule 升级后 `inner` 字段不可见,
    /// 加此公开 getter 替代私有字段访问。
    pub fn cancel_token(&self) -> Option<tokio_util::sync::CancellationToken> {
        self.inner
            .thread
            .lock()
            .as_ref()
            .map(|t| t.cancel_token().clone())
    }

    /// 诊断接口:返回当前 model spec (供前端 settings UI 显示)。
    pub fn model_spec(&self) -> String {
        self.inner.model_spec.read().clone()
    }

    /// 目标模式的**权威状态**快照 —— 跑到第几轮 / LM 判定 / 累计 token /
    /// 被什么卡住。`None` = 没有活跃目标。
    ///
    /// 目标模式**没有协议事件** —— GUI 此前只能靠前端投影(`goalActive`)
    /// 猜「是否活跃」,投影在会话切换 / 后端 rebind 后就会与真实状态脱节。
    /// 上游把 `GoalController` 放进会话级共享槽后,这里能读到真值。
    pub fn goal_snapshot(&self) -> Option<reflect_goal::GoalState> {
        self.inner
            .thread
            .lock()
            .as_ref()
            .and_then(|t| t.goal_snapshot())
    }

    /// 诊断接口:返回当前 workspace (供前端显示)。优先返回运行时通过
    /// `set_workspace` 设置的 override,fallback 到启动时的 cwd。
    pub fn workspace(&self) -> PathBuf {
        crate::workspace_state::WorkspaceState::get()
            .unwrap_or_else(|| self.inner.workspace.clone())
    }

    /// 共享 config 只读句柄(settings 读写命令、热重载用)。
    pub fn cfg(&self) -> Arc<RwLock<ReflectConfig>> {
        Arc::clone(&self.inner.cfg)
    }

    /// 共享 ToolRegistry(MCP/LSP 后续 register_plugin_tool、tool 列表命令用)。
    pub fn tools(&self) -> Arc<ToolRegistry> {
        Arc::clone(&self.inner.tools)
    }

    /// 插件运行时句柄(submit 边界展开 `/plugin:*` 命令用;内层 `None`
    /// = 未挂载,展开直通)。挂载由 `state/plugins.rs` 在真实会话 rebind
    /// 时异步完成。
    pub fn plugin_runtime(&self) -> reflect_plugin::SharedPluginRuntime {
        self.inner.plugin_runtime.clone()
    }

    /// Task/Team 管理器(供多 agent 命令面调用)。
    /// 命令层 `commands/tasks.rs` 通过本句柄调用 `TaskManager` 的 create/get/
    /// update/list/claim/upsert_team/list_teams 等方法。
    pub fn task_manager(&self) -> Arc<reflect_task::TaskManager> {
        Arc::clone(&self.inner.task_manager)
    }

    /// Cron 调度器句柄。
    /// 返回当前 scheduler 的 clone(若已 install);未 install 时返回 `None`。
    /// 命令层 `commands/schedule.rs` 据此决定走真 scheduler 还是空响应。
    pub fn cron_scheduler(&self) -> Option<reflect_stream::cron::CronScheduler> {
        self.inner.cron_scheduler.read().clone()
    }

    /// 远程模式配置：host + port + auth_token + auto_connect。
    /// 命令层 `commands/remote.rs` 用它持久化配置(进程内);连接状态(传输 up/down)
    /// 留作后续 driver 任务。
    pub fn remote_config(&self) -> RemoteConfig {
        self.inner.remote_config.read().clone()
    }

    /// 写入远程配置(覆盖式)。返回更新后的 snapshot。
    pub fn set_remote_config(&self, cfg: RemoteConfig) -> RemoteConfig {
        *self.inner.remote_config.write() = cfg.clone();
        cfg
    }

    /// KMS 知识库管理器。
    pub fn kms_manager(&self) -> &reflect_kms::KnowledgeManager {
        &self.inner.kms_manager
    }

    /// Autopilot 管理器。
    pub fn autopilot_manager(&self) -> &reflect_stream::autopilot::AutopilotManager {
        &self.inner.autopilot_manager
    }

    /// Activity 日志管理器。
    /// `install_agent_thread` 会 spawn 一个 task 订阅 session broadcast,
    /// 把 `Event` 映射成 `ActivityEvent` 写入。
    pub fn activity_log(&self) -> Arc<reflect_app_core::activity::ActivityLog> {
        Arc::clone(&self.inner.activity_log)
    }

    /// Squad 管理器:复用 task_manager 的 team 存储。
    pub fn squad_manager(&self) -> Arc<reflect_task::SquadManager> {
        Arc::clone(&self.inner.squad_manager)
    }

    /// v1.x:当前后端 AgentThread 绑定的 session id(`None` = 尚未
    /// 绑定或仍在 install 时随机 id 上)。命令层用此判断是否需要 rebind。
    pub(crate) fn bound_session_id(&self) -> Option<reflect_protocol::ThreadId> {
        *self.inner.bound_session_id.lock()
    }

    /// v1.x:共享 ModelRegistry 是否已构建(provider/degraded 分支后)。
    /// 命令层(尤其 `reflect_bind_session`)必须先看此再 rebind。
    pub(crate) fn model_registry_ready(&self) -> bool {
        self.inner.model_registry.lock().is_some()
    }

    /// 构造 scheduler + 启动 driver(30s tick),返回 `(scheduler, driver_handle)`。
    /// 调用方负责把句柄存入 inner 或在用完时 stop 后重启。
    ///
    /// driver 句柄必须存入 `inner.cron_driver` —— 立即 drop 会让 driver 任务
    /// 被 abort,cron 永不触发(v1.x 修复的根因)。
    /// 幂等:已有 scheduler(含 jobs)时把 jobs 迁移过来,重复 install 不丢 jobs。
    pub(crate) fn spawn_cron_scheduler(
        &self,
        sender: tokio::sync::mpsc::Sender<reflect_protocol::Submission>,
    ) -> (
        reflect_stream::cron::CronScheduler,
        reflect_stream::cron::CronDriverHandle,
    ) {
        let existing = self.inner.cron_scheduler.read().clone();
        let mut scheduler = existing.unwrap_or_else(|| {
            reflect_stream::cron::CronScheduler::new(None, reflect_protocol::ThreadId::new())
        });
        scheduler.rebind_sender(Some(sender));
        let driver = scheduler.clone();
        let driver_handle = driver.start(30);
        (scheduler, driver_handle)
    }

    /// 列出当前活跃的 shell session id。
    pub fn list_shell_sessions(&self) -> Vec<String> {
        self.inner.shell_sessions.list()
    }

    /// 诊断快照:供前端显示状态徽标。
    pub fn agent_status(&self) -> AgentStatus {
        let thread = self.inner.thread.lock().clone();
        let thread_ready = thread.as_ref().is_some_and(|thread| {
            !thread.cancel_token().is_cancelled() && !thread.submission_sender().is_closed()
        });
        // 占位线程没有绑定会话，显示下一次绑定将使用的配置；已绑定
        // 会话则显示线程实际模型，即使新配置重绑失败也不会误报。
        let model = thread
            .as_ref()
            .filter(|thread| thread.config().session_id.is_some())
            .map(|thread| thread.config().current_model())
            .unwrap_or_else(|| self.model_spec());
        let has_model = model != "stub/test";
        AgentStatus {
            ready: thread_ready,
            has_model,
            model,
            workspace: self.workspace().display().to_string(),
            degraded_reason: self.inner.degraded_reason.lock().clone(),
        }
    }

    // ====== 各领域 domain API ======

    /// 更新当前 active workspace(仅在内存中生效)。
    pub fn set_workspace(&self, path: PathBuf) {
        crate::workspace_state::WorkspaceState::set(path);
    }

    pub fn workspace_override() -> Option<PathBuf> {
        crate::workspace_state::WorkspaceState::get()
    }

    /// 列出所有 scope 下的 memory entry。
    pub fn list_memory(&self) -> anyhow::Result<Vec<crate::commands::MemoryEntry>> {
        self.inner.memory_store.list(&self.workspace())
    }

    /// 新增 memory entry。向对应 scope 的 `MEMORY.md` 追加
    /// `## <key>\n<value>`。
    pub fn add_memory(
        &self,
        scope: String,
        key: String,
        value: String,
        replace_document: bool,
        create_only: bool,
        expected_value: Option<String>,
    ) -> anyhow::Result<()> {
        self.inner.memory_store.add(
            &scope,
            &key,
            &value,
            &self.workspace(),
            replace_document,
            create_only,
            expected_value.as_deref(),
        )
    }

    /// 删除 memory entry,移除对应的 `## <key>` 块。
    pub fn remove_memory(
        &self,
        scope: String,
        key: String,
        replace_document: bool,
        expected_value: Option<String>,
    ) -> anyhow::Result<()> {
        self.inner.memory_store.remove(
            &scope,
            &key,
            &self.workspace(),
            replace_document,
            expected_value.as_deref(),
        )
    }

    /// 列出已注册的 hook。
    pub fn list_hooks(&self) -> anyhow::Result<Vec<crate::commands::HookInfo>> {
        let thread = self
            .inner
            .thread
            .lock()
            .clone()
            .ok_or_else(|| anyhow::anyhow!("agent thread is not ready"))?;
        let mut hooks = self.inner.hook_store.list(&thread.hook_engine());
        hooks.retain(|hook| hook.name != plugin_hooks::FORWARDER_NAME);
        if let Some(engine) = self.plugin_hook_engine(&thread) {
            hooks.extend(self.inner.hook_store.list(&engine));
        }
        Ok(hooks)
    }

    /// 切换 hook 的启用状态。
    pub fn toggle_hook(&self, name: String, enabled: bool) -> anyhow::Result<()> {
        let thread = self
            .inner
            .thread
            .lock()
            .clone()
            .ok_or_else(|| anyhow::anyhow!("agent thread is not ready"))?;
        if name == plugin_hooks::FORWARDER_NAME {
            anyhow::bail!("internal hook cannot be toggled");
        }
        let engine = self
            .plugin_hook_engine(&thread)
            .filter(|engine| {
                engine
                    .hook_names()
                    .iter()
                    .any(|registered| registered == &name)
            })
            .unwrap_or_else(|| thread.hook_engine());
        self.inner.hook_store.toggle(&engine, &name, enabled)
    }

    fn plugin_hook_engine(
        &self,
        thread: &Arc<reflect_core::AgentThread>,
    ) -> Option<Arc<reflect_hooks::HookEngine>> {
        let slot = self.inner.plugin_hook_slot.lock();
        let slot = slot.as_ref()?;
        let owner = slot.thread.upgrade()?;
        Arc::ptr_eq(&owner, thread).then(|| slot.bridge.engine.clone())
    }

    pub(crate) fn activate_plugin_mount(&self, thread: &Arc<reflect_core::AgentThread>) {
        if let Some(slot) = self.inner.plugin_hook_slot.lock().as_ref() {
            if slot
                .thread
                .upgrade()
                .is_some_and(|owner| Arc::ptr_eq(&owner, thread))
            {
                slot.activate.send_replace(true);
            }
        }
    }

    pub(crate) async fn wait_for_plugins(
        &self,
        thread: &Arc<reflect_core::AgentThread>,
    ) -> anyhow::Result<()> {
        let bridge = {
            let slot = self.inner.plugin_hook_slot.lock();
            slot.as_ref().and_then(|slot| {
                slot.thread
                    .upgrade()
                    .filter(|owner| Arc::ptr_eq(owner, thread))
                    .map(|_| slot.bridge.clone())
            })
        };
        if let Some(bridge) = bridge {
            bridge.wait_ready().await?;
        }
        Ok(())
    }
}
