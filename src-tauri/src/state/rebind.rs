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
//! 旧线程排空:`rebind_session` 调 `old.cancel_token().cancel()`,有界
//! 排空在途旧 turn;其事件仍走共享 session_tx 广播(衰减期内可能到达
//! 新会话视图,reducer 行为同现有"`appendItem` 创建未知 id turn" —
//! 表现为新会话视图里的瞬态气泡,见风险表)。

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
    if !agent.model_registry_ready() {
        anyhow::bail!("agent 未安装或 registry 未就绪");
    }
    // 同 id 短路(允许 ChatView 在已水合时仍调 bind);forced 变体跳过。
    if !force && agent.bound_session_id() == Some(sid) {
        debug!("rebind_session: {sid} 已是当前绑定,短路");
        return Ok(());
    }

    // 1. 取消旧 turn(有界排空)。读出旧 Arc,取消其 token,然后**立即
    //    释放 thread-slot 锁**再调 `start_forwarder`(ParkingMutex 非重入)。
    let old_thread = agent.inner.thread.lock().clone();
    if let Some(old) = old_thread.as_ref() {
        old.cancel_token().cancel();
    }
    drop(old_thread); // drop guard

    // 1.5 尽早停旧 cron driver:`CronScheduler::start` 把旧 `sub_tx` **按值捕获**
    //     进 driver 任务,`rebind_sender` 只改 scheduler 字段、对运行中的旧
    //     driver 无效(上游 cron.rs 文档明示须 stop + restart)。若旧 driver
    //     活到 step 2(`construct_thread` 含磁盘 I/O)才停,窗口内到期 job
    //     经旧 sender 投进已 cancel 的旧线程 → 该次触发静默丢失
    //     (`next_fire` 已推进,不会补触发)。停止后到期 job 由新 driver 的
    //     首个 tick 补发(`tokio::time::interval` 首次 tick 立即完成,
    //     `tick` 扫描所有 `next_fire <= now` 的 job),不丢触发。
    //     代价:若 step 2 construct 失败,cron 处于暂停态(旧线程已 cancel,
    //     向其投递本就无意义);下一次成功的 rebind 会重启 driver。
    if let Some(mut old_driver) = agent.inner.cron_driver.lock().take() {
        old_driver.stop();
    }

    // 2. 构造新 thread(recorder 绑定新 sid,preload 注入历史,
    //    initial_mode 恢复会话级权限模式)。
    let thread = construct_thread(agent, Some(sid), preload, initial_mode)?;

    // 3. 单次赋值换槽 — `agent_status().ready` 不闪断(None 中间态不外露)。
    *agent.inner.thread.lock() = Some(thread.clone());
    *agent.inner.bound_session_id.lock() = Some(sid);

    // 4. 为新 thread 起独立 forwarder(共享 session_tx;旧的随旧 thread
    //    排空结束自动退出)。
    super::session::start_forwarder(agent);

    // 5. Cron 换向:旧 driver 已在 step 1.5 停止,这里写新 sender 并起
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

    /// install 未完成时 rebind 必须失败,且不污染 state。
    #[tokio::test]
    async fn rebind_before_install_fails() {
        let agent = MinimalAgent::new_empty();
        let sid = reflect_protocol::ThreadId::new();
        assert!(rebind_session(&agent, sid, vec![], None).is_err());
        assert!(agent.bound_session_id().is_none());
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
        let original_id = job.id.clone();

        let sid = reflect_protocol::ThreadId::new();
        rebind_session(&agent, sid, vec![], None).unwrap();
        // 重建 scheduler / 重启 driver 后,job 列表应仍含同一 id。
        let after_ids: Vec<String> = agent
            .cron_scheduler()
            .expect("rebind 后 scheduler 仍存在")
            .list()
            .into_iter()
            .map(|j| j.id)
            .collect();
        assert!(
            after_ids.contains(&original_id),
            "job id 必须在 rebind 后保留"
        );
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
