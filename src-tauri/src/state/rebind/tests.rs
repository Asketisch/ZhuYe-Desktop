//! rebind 就位测试(自 `rebind.rs` 拆出,`reload/tests.rs` 同款
//! `#[cfg(test)] mod tests;` 目录形式;后台持续运行行为用例也在此)。
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
    // 测试任务不得写入用户的持久化 cron 存储。
    *agent.inner.cron_scheduler.write() = Some(reflect_stream::cron::CronScheduler::new(
        None,
        ThreadId::new(),
    ));
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

/// v1.x 后台持续运行:跨会话换绑后旧线程**不被 cancel**且入后台表;
/// bind 回该会话时 promote 复用同一 Arc(不重建)。
#[tokio::test]
async fn rebind_demotes_old_thread_and_promotes_warm_thread() {
    let agent = MinimalAgent::new_empty();
    *agent.inner.cfg.write() = reflect_config::ReflectConfig::default();
    agent.install_agent_thread().await;
    let session_a = ThreadId::new();
    rebind_session(&agent, session_a, vec![], None).unwrap();
    let thread_a = agent.inner.thread.lock().clone().unwrap();

    let session_b = ThreadId::new();
    rebind_session(&agent, session_b, vec![], None).unwrap();
    // A 降级后台:token 未取消、表内有且 running 标记由 forwarder 维护
    // (此测试无事件,只验表)。
    assert!(
        !thread_a.cancel_token().is_cancelled(),
        "切走不得 cancel 旧线程(会话级令牌 = Op::Shutdown)"
    );
    assert!(
        agent
            .inner
            .background
            .lock()
            .iter()
            .any(|(sid, t)| *sid == session_a && Arc::ptr_eq(t, &thread_a)),
        "旧线程必须入后台表"
    );
    assert!(
        !Arc::ptr_eq(&thread_a, agent.inner.thread.lock().as_ref().unwrap()),
        "前台槽必须换到新会话线程"
    );

    // bind 回 A:promote 复用 warm 线程(同一 Arc),后台表清空该表项。
    rebind_session(&agent, session_a, vec![], None).unwrap();
    let foreground = agent.inner.thread.lock().clone().unwrap();
    assert!(
        Arc::ptr_eq(&foreground, &thread_a),
        "promote 必须复用后台 warm 线程"
    );
    assert!(
        !agent
            .inner
            .background
            .lock()
            .iter()
            .any(|(sid, _)| *sid == session_a),
        "promote 后表项必须移除"
    );
    assert!(
        !agent.inner.background_running.lock().contains(&session_a),
        "promote 后 running 标记必须清除"
    );
}

/// promote(bind 回后台会话)不得**再起**一个 forwarder。
///
/// `AgentThread::subscribe_session()` 是追加订阅者语义(每次调用新建一条
/// mpsc 通道并挂进 `session_subs`)—— 同一线程挂两个 forwarder,每条事件
/// 都会被**双发**到前台通道(delta 文本翻倍)。线程的会话 id 终身不变,
/// 其 forwarder 从首次绑定起一直存活,promote 只需复用。
#[tokio::test]
async fn promote_does_not_start_second_forwarder() {
    use std::sync::atomic::Ordering;

    let agent = MinimalAgent::new_empty();
    *agent.inner.cfg.write() = reflect_config::ReflectConfig::default();
    agent.install_agent_thread().await;

    let session_a = ThreadId::new();
    rebind_session(&agent, session_a, vec![], None).unwrap();
    let after_bind_a = agent.inner.forwarder_count.load(Ordering::Relaxed);

    // 切到 B:新线程 → 新起一个 forwarder(A 的 forwarder 继续存活)。
    let session_b = ThreadId::new();
    rebind_session(&agent, session_b, vec![], None).unwrap();
    assert_eq!(
        agent.inner.forwarder_count.load(Ordering::Relaxed),
        after_bind_a + 1,
        "换绑到新会话应为新线程起一个 forwarder"
    );

    // bind 回 A:promote 复用 warm 线程 —— 不得再起 forwarder。
    rebind_session(&agent, session_a, vec![], None).unwrap();
    assert_eq!(
        agent.inner.forwarder_count.load(Ordering::Relaxed),
        after_bind_a + 1,
        "promote 不得再起 forwarder(否则同一线程的事件被双发)"
    );
}

/// 原地重建(同 id + pending error)必须 cancel 旧线程 —— 同一 session
/// 不允许两个 live 线程写同一 rollout 文件。
#[tokio::test]
async fn in_place_rebuild_cancels_old_thread() {
    let agent = MinimalAgent::new_empty();
    *agent.inner.cfg.write() = reflect_config::ReflectConfig::default();
    agent.install_agent_thread().await;
    let sid = ThreadId::new();
    rebind_session(&agent, sid, vec![], None).unwrap();
    let old = agent.inner.thread.lock().clone().unwrap();
    *agent.inner.pending_rebind_error.lock() = Some("probe".into());
    rebind_session(&agent, sid, vec![], None).unwrap();
    assert!(
        old.cancel_token().is_cancelled(),
        "原地重建必须 cancel 旧线程"
    );
    assert!(
        !agent.inner.background.lock().iter().any(|(s, _)| *s == sid),
        "原地重建不得把同会话线程降级后台"
    );
}

/// forced(热重载)清空后台表:provider 栈已重建,后台线程攥旧 registry。
#[tokio::test]
async fn forced_rebind_clears_background_threads() {
    let agent = MinimalAgent::new_empty();
    *agent.inner.cfg.write() = reflect_config::ReflectConfig::default();
    agent.install_agent_thread().await;
    let session_a = ThreadId::new();
    rebind_session(&agent, session_a, vec![], None).unwrap();
    let thread_a = agent.inner.thread.lock().clone().unwrap();
    rebind_session(&agent, ThreadId::new(), vec![], None).unwrap();
    assert!(!agent.inner.background.lock().is_empty());
    assert!(!thread_a.cancel_token().is_cancelled());

    rebind_session_forced(&agent, agent.bound_session_id().unwrap(), vec![], None).unwrap();
    assert!(
        agent.inner.background.lock().is_empty(),
        "热重载必须清空后台表"
    );
    assert!(
        thread_a.cancel_token().is_cancelled(),
        "清场必须 cancel 后台线程"
    );
}

/// v1.x:GUI 主线程必须注册 PlanModeGate(与 CLI headless 的无条件注册
/// 对齐)。此前 GUI 从不注册该 gate —— Plan 只读边界只剩 pre_loop 的
/// write/edit 裁剪 + 审批层软约束,bash 写命令可被审批策略自动放行,
/// `plan_safe_bash` 免审批短路还建立在「gate 已分级」的错误前提上。
#[tokio::test]
async fn installed_thread_registers_plan_mode_gate() {
    let agent = MinimalAgent::new_empty();
    agent.install_agent_thread().await;
    let thread = agent
        .inner
        .thread
        .lock()
        .clone()
        .expect("install 后 thread 必须非空");
    let names = thread.hook_engine().hook_names();
    assert!(
        names.iter().any(|n| n == "plan_mode_gate"),
        "GUI 主线程必须注册 plan_mode_gate,实得 {names:?}"
    );
}

/// 同一断言在 rebind 路径上成立(rebind 恢复 Plan 模式的会话同样受保护)。
#[tokio::test]
async fn rebound_thread_registers_plan_mode_gate() {
    let agent = MinimalAgent::new_empty();
    agent.install_agent_thread().await;
    let sid = ThreadId::new();
    rebind_session(&agent, sid, vec![], None).expect("rebind 不应失败");
    let thread = agent
        .inner
        .thread
        .lock()
        .clone()
        .expect("rebind 后 thread 必须非空");
    assert!(
        thread
            .hook_engine()
            .hook_names()
            .iter()
            .any(|n| n == "plan_mode_gate"),
        "rebind 构造的线程也必须注册 plan_mode_gate"
    );
}

/// v1.x:GUI 线程必须注册首轮上下文注入 hooks(环境块 + AGENTS.md)——
/// 修复「headless 注册而桌面半接线」的缺口(见 thread_factory 注册点)。
#[tokio::test]
async fn installed_thread_registers_context_injection_hooks() {
    let agent = MinimalAgent::new_empty();
    agent.install_agent_thread().await;
    let thread = agent
        .inner
        .thread
        .lock()
        .clone()
        .expect("install 后 thread 必须非空");
    let names = thread.hook_engine().hook_names();
    assert!(
        names.iter().any(|n| n == "env-context-inject"),
        "GUI 主线程必须注册 env-context-inject,实得 {names:?}"
    );
    assert!(
        names.iter().any(|n| n == "agents-md-inject"),
        "GUI 主线程必须注册 agents-md-inject(`[active] agents_md` 缺省开),实得 {names:?}"
    );
}
