//! `rebind_session` —— 把后端 AgentThread 换绑到指定 session id。
//!
//! 触发动机:
//! - New Chat → `reflect_create_session` 分配 id → 路由跳转 → ChatView
//!   挂载时调 `reflect_bind_session(new_id)`,空历史绑定,首条消息落盘。
//! - 切换历史会话 → ChatView 重新挂载,带 replay 出的历史 binding,LLM
//!   恢复上下文,后续消息续写到该 id。
//!
//! 不变量(由 ChatView 加载序列保证):
//! - bind 期间 Composer 不渲染(loading gate),消除 bind 前发送竞态。
//! - 同 id 二次 bind 短路(后端幂等),允许"已水合也要先 bind"的 FE 序列。
//!
//! 旧线程排空:`rebind_session` 取消旧 turn；转发器在换绑后丢弃旧线程事件。

use reflect_llm::ChatMessage;
use reflect_protocol::{PermissionMode, ThreadId};
use tracing::{debug, warn};

use super::MinimalAgent;
use super::thread_factory::construct_thread;

/// 把 agent 的 AgentThread 换绑到指定 session id(带 preload 历史)。
///
/// `initial_mode` 为 `Some` 时作为新线程的会话级 PermissionMode
/// (来自该 session JSONL 审计轨迹的末次 `PermissionModeChanged`),
/// 实现模式随会话恢复;`None` 落默认 Auto。
///
/// 必须在 tokio 上下文调用(`AgentThread::new` 内部 `tokio::spawn`)。
///
/// 失败模式:
/// - `model_registry` 未就绪(`install_agent_thread` 没跑完)→ 返回
///   `Err`,不修改任何 state,命令层把 `CommandError` 推前端。
/// - `construct_thread` 内部 `build_default_m4` 失败(异常,如磁盘满)→
///   同样的 Err,原 thread 保留(不替换)。
pub(crate) fn rebind_session(
    agent: &MinimalAgent,
    sid: ThreadId,
    preload: Vec<ChatMessage>,
    initial_mode: Option<PermissionMode>,
) -> anyhow::Result<()> {
    rebind_session_inner(agent, sid, preload, initial_mode, false)
}

/// 强制重绑:跳过同 id 短路,无条件重建线程。
///
/// coding plan 热切换路径(`state/reload.rs::hot_reload_provider_stack`)
/// 使用:provider 相关配置变更后,当前绑定会话必须换到新 registry/tracker
/// 上,否则新计划要到下次切换会话才生效。`initial_mode` 传旧线程当前
/// 模式,保证热重载不重置权限模式。
pub(crate) fn rebind_session_forced(
    agent: &MinimalAgent,
    sid: ThreadId,
    preload: Vec<ChatMessage>,
    initial_mode: Option<PermissionMode>,
) -> anyhow::Result<()> {
    rebind_session_inner(agent, sid, preload, initial_mode, true)
}

fn rebind_session_inner(
    agent: &MinimalAgent,
    sid: ThreadId,
    preload: Vec<ChatMessage>,
    initial_mode: Option<PermissionMode>,
    force: bool,
) -> anyhow::Result<()> {
    rebind_session_with(agent, sid, preload, initial_mode, force, construct_thread)
}

fn rebind_session_with(
    agent: &MinimalAgent,
    sid: ThreadId,
    preload: Vec<ChatMessage>,
    initial_mode: Option<PermissionMode>,
    force: bool,
    build: impl FnOnce(
        &MinimalAgent,
        Option<ThreadId>,
        Vec<ChatMessage>,
        Option<PermissionMode>,
    ) -> anyhow::Result<std::sync::Arc<reflect_core::AgentThread>>,
) -> anyhow::Result<()> {
    let _rebind = agent.inner.rebind_lock.lock();
    if !agent.model_registry_ready() {
        anyhow::bail!("agent 未安装或 registry 未就绪");
    }
    // 热重载可能在异步回放期间遇到用户切换会话，不可切回旧会话。
    if force && agent.bound_session_id() != Some(sid) {
        debug!("rebind_session: stale forced rebind for {sid}, skipped");
        return Ok(());
    }
    // 同 id 短路(允许 ChatView 在已水合时仍调 bind);forced 变体跳过。
    let current_usable = agent.inner.thread.lock().as_ref().is_some_and(|thread| {
        !thread.cancel_token().is_cancelled() && !thread.submission_sender().is_closed()
    });
    if !force
        && agent.bound_session_id() == Some(sid)
        && current_usable
        && agent.inner.pending_rebind_error.lock().is_none()
    {
        debug!("rebind_session: {sid} 已是当前绑定,短路");
        return Ok(());
    }

    // 先完成可能失败的构造；失败时旧线程和 cron 必须继续工作。
    let thread = build(agent, Some(sid), preload, initial_mode)?;

    // 1. 取消旧 turn(有界排空)。读出旧 Arc,取消其 token,然后**立即
    //    释放 thread-slot 锁**再调 `start_forwarder`(ParkingMutex 非重入)。
    let old_thread = agent.inner.thread.lock().clone();
    if let Some(old) = old_thread.as_ref() {
        old.cancel_token().cancel();
    }
    drop(old_thread); // drop guard

    // 1.5 尽早停旧 cron driver:`CronScheduler::start` 把旧 `sub_tx` **按值捕获**
    //     进 driver 任务,`rebind_sender` 只改 scheduler 字段、对运行中的旧
    //     driver 无效(上游 cron.rs 文档明示须 stop + restart)。停止后
    //     到期 job 由新 driver 的
    //     首个 tick 补发(`tokio::time::interval` 首次 tick 立即完成,
    //     `tick` 扫描所有 `next_fire <= now` 的 job),不丢触发。
    if let Some(mut old_driver) = agent.inner.cron_driver.lock().take() {
        old_driver.stop();
    }

    // 2. 单次赋值换槽 — `agent_status().ready` 不闪断(None 中间态不外露)。
    *agent.inner.thread.lock() = Some(thread.clone());
    *agent.inner.task_hook_target.write() = Some(thread.hook_engine());
    *agent.inner.bound_session_id.lock() = Some(sid);
    super::reload::clear_pending_rebind(agent);
    agent.activate_plugin_mount(&thread);

    // 3. 为新 thread 起独立 forwarder(共享 session_tx;旧的随旧 thread
    //    排空结束自动退出)。
    super::session::start_forwarder(agent);

    // 4. Cron 换向:旧 driver 已在 step 1.5 停止,这里写新 sender 并起
    //    新 driver(首个 tick 立即扫描,补发窗口内到期的 job),保留 job id。
    //
    // 锁序注意:先**读锁 clone + 释放 guard**,再取写锁写回 ——
    // `if let ... = lock.write().clone()` 的 scrutinee 临时值(RwLockWriteGuard)
    // 活到整个 if-let 块结束,块内再对同一把锁 `write()` 会自死锁
    // (parking_lot 非重入)。rebind 单测曾因此永久 park。
    let sched_opt = agent.inner.cron_scheduler.read().clone();
    if let Some(mut sched) = sched_opt {
        sched.rebind_sender(Some(thread.submission_sender()));
        // 持久化回 inner(若本进程第一次 install 就崩了,cron_scheduler
        // 仍为 None,跳过 cron 切向 — install 完整跑通的情况下不会出现)。
        *agent.inner.cron_scheduler.write() = Some(sched.clone());
        let new_driver = sched.clone();
        let new_handle = new_driver.start(30);
        *agent.inner.cron_driver.lock() = Some(new_handle);
    } else {
        warn!("rebind_session: cron_scheduler 尚未 install,跳过 cron 切向");
    }

    debug!("rebind_session: → {sid} 完成");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::MinimalAgent;
    use std::sync::Arc;

    /// rebind 之后 `bound_session_id` 必须等于目标 id,且 thread 槽不为空。
    #[tokio::test]
    async fn rebind_updates_bound_id_and_ready() {
        let agent = MinimalAgent::new_empty();
        agent.install_agent_thread().await;
        assert!(agent.bound_session_id().is_none(), "install 不绑定 id");
        let sid = reflect_protocol::ThreadId::new();
        rebind_session(&agent, sid, vec![], None).expect("rebind 不应失败");
        assert_eq!(agent.bound_session_id(), Some(sid));
        assert!(agent.inner.thread.lock().is_some(), "thread 槽必须非空");
    }

    /// 同 id 二次 rebind 短路:bound_session_id 与 thread Arc 都不变。
    #[tokio::test]
    async fn rebind_same_id_is_noop() {
        let agent = MinimalAgent::new_empty();
        agent.install_agent_thread().await;
        let sid = reflect_protocol::ThreadId::new();
        rebind_session(&agent, sid, vec![], None).unwrap();
        let thread1 = agent.inner.thread.lock().clone();
        rebind_session(&agent, sid, vec![], None).unwrap();
        let thread2 = agent.inner.thread.lock().clone();
        assert!(
            Arc::ptr_eq(thread1.as_ref().unwrap(), thread2.as_ref().unwrap()),
            "同 id 二次 rebind 必须短路(thread Arc 不变)"
        );
    }

    #[tokio::test]
    async fn same_session_rebind_retries_pending_configuration() {
        let agent = MinimalAgent::new_empty();
        *agent.inner.cfg.write() = reflect_config::ReflectConfig::default();
        agent.install_agent_thread().await;
        let sid = ThreadId::new();
        rebind_session(&agent, sid, vec![], None).unwrap();
        let old = agent.inner.thread.lock().clone().unwrap();
        *agent.inner.pending_rebind_error.lock() = Some("rebind probe".into());
        *agent.inner.degraded_reason.lock() = Some("other issue; rebind probe".into());
        rebind_session(&agent, sid, vec![], None).unwrap();
        assert!(!Arc::ptr_eq(
            &old,
            agent.inner.thread.lock().as_ref().unwrap()
        ));
        assert!(agent.inner.pending_rebind_error.lock().is_none());
        assert_eq!(
            agent.inner.degraded_reason.lock().as_deref(),
            Some("other issue")
        );
    }

    #[tokio::test]
    async fn stale_forced_rebind_does_not_restore_previous_session() {
        let agent = MinimalAgent::new_empty();
        *agent.inner.cfg.write() = reflect_config::ReflectConfig::default();
        agent.install_agent_thread().await;
        let previous = reflect_protocol::ThreadId::new();
        let current = reflect_protocol::ThreadId::new();
        rebind_session(&agent, previous, vec![], None).unwrap();
        rebind_session(&agent, current, vec![], None).unwrap();
        let thread = agent.inner.thread.lock().clone().unwrap();
        rebind_session_forced(&agent, previous, vec![], None).unwrap();
        assert_eq!(agent.bound_session_id(), Some(current));
        assert!(Arc::ptr_eq(
            &thread,
            agent.inner.thread.lock().as_ref().unwrap()
        ));
    }

    /// install 未完成时 rebind 必须失败,且不污染 state。
    #[tokio::test]
    async fn rebind_before_install_fails() {
        let agent = MinimalAgent::new_empty();
        let sid = reflect_protocol::ThreadId::new();
        assert!(rebind_session(&agent, sid, vec![], None).is_err());
        assert!(agent.bound_session_id().is_none());
    }

    #[tokio::test]
    async fn failed_thread_construction_keeps_current_thread_running() {
        let agent = MinimalAgent::new_empty();
        *agent.inner.cfg.write() = reflect_config::ReflectConfig::default();
        agent.install_agent_thread().await;
        let old = agent.inner.thread.lock().clone().unwrap();
        assert!(agent.inner.cron_driver.lock().is_some());
        let result = rebind_session_with(
            &agent,
            ThreadId::new(),
            vec![],
            None,
            false,
            |_, _, _, _| anyhow::bail!("construction failed"),
        );
        assert!(result.is_err());
        assert!(!old.cancel_token().is_cancelled());
        assert!(Arc::ptr_eq(
            &old,
            agent.inner.thread.lock().as_ref().unwrap()
        ));
        assert!(agent.inner.cron_driver.lock().is_some());
    }

    /// rebind 后 cron job 跨重启 id 保留(避免换绑导致 job 重新分配)。
    #[tokio::test]
    async fn rebind_preserves_cron_job_ids() {
        let agent = MinimalAgent::new_empty();
        agent.install_agent_thread().await;
        // 创建一条 cron 任务。
        let job = agent
            .cron_scheduler()
            .expect("install 后 scheduler 已建")
            .create("* * * * *", "test prompt", None)
            .expect("schedule valid");
        let original_id = job.id;

        let sid = reflect_protocol::ThreadId::new();
        rebind_session(&agent, sid, vec![], None).unwrap();
        // 重建 scheduler / 重启 driver 后,job 列表应仍含同一 id。
        let job_kept = agent
            .cron_scheduler()
            .expect("rebind 后 scheduler 仍存在")
            .list()
            .into_iter()
            .any(|j| j.id == original_id);
        assert!(job_kept, "job id 必须在 rebind 后保留");
    }

    /// `initial_mode = Some` 时新线程必须带上该会话级 PermissionMode
    /// (模式随会话恢复,而非落回全局默认 Auto)。
    #[tokio::test]
    async fn rebind_restores_initial_permission_mode() {
        let agent = MinimalAgent::new_empty();
        agent.install_agent_thread().await;
        let sid = reflect_protocol::ThreadId::new();
        rebind_session(&agent, sid, vec![], Some(PermissionMode::Plan)).unwrap();
        let thread = agent.inner.thread.lock().clone().unwrap();
        assert_eq!(
            thread.config().permission_mode(),
            PermissionMode::Plan,
            "rebind 必须把 initial_mode 应用到新线程"
        );
        // 对照:None → 默认 Auto。
        let sid2 = reflect_protocol::ThreadId::new();
        rebind_session(&agent, sid2, vec![], None).unwrap();
        let thread2 = agent.inner.thread.lock().clone().unwrap();
        assert_eq!(
            thread2.config().permission_mode(),
            PermissionMode::Auto,
            "initial_mode 缺省时新线程落默认 Auto"
        );
    }
}
