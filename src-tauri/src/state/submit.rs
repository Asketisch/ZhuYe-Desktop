//! `submit` / `submit_op` / `interrupt` —— per-turn 提交流水。
//!
//! 提交流程:1) 拿 AgentThread handle;2) 构造 `Submission`;3) 投给
//! `agent_thread.submit(...)` 拿 `TurnHandle`;4) spawn 一个 forwarder
//! 把该 turn 的所有 event 推 session broadcast。
//!
//! 前端按 `event.id == submission.id` 过滤出属于本次 turn 的事件;
//! `submit_op` 自动生成 id,审批/effort/permission 这类 op 走相同的
//! 生命周期事件 fan-out。

use super::MinimalAgent;
use std::path::Path;
use std::sync::Arc;

fn current_thread(agent: &MinimalAgent) -> anyhow::Result<Arc<reflect_core::AgentThread>> {
    agent
        .inner
        .thread
        .lock()
        .clone()
        .ok_or_else(|| anyhow::anyhow!("agent thread not installed yet; setup not complete"))
}

fn ensure_current_thread(
    agent: &MinimalAgent,
    thread: &Arc<reflect_core::AgentThread>,
) -> anyhow::Result<()> {
    if !agent
        .inner
        .thread
        .lock()
        .as_ref()
        .is_some_and(|current| Arc::ptr_eq(current, thread))
    {
        anyhow::bail!("session changed before submission; retry in the current session");
    }
    if thread.cancel_token().is_cancelled() || thread.submission_sender().is_closed() {
        anyhow::bail!("session thread is closed; rebind the session before submitting");
    }
    Ok(())
}

fn ensure_workspace_matches(
    thread_workspace: &Path,
    current_workspace: &Path,
    submitted_workspace: Option<&str>,
) -> anyhow::Result<()> {
    use crate::workspace_state::same_path;
    if !same_path(thread_workspace, current_workspace)
        || submitted_workspace.is_some_and(|path| !same_path(thread_workspace, Path::new(path)))
    {
        anyhow::bail!(
            "workspace changed since this session was bound; reopen the session or start a new chat"
        );
    }
    Ok(())
}

/// 提交 Submission → 拿 per-turn `TurnHandle` → spawn 转发到 broadcast。
///
/// 前端拿到的所有 per-turn event 都通过 session broadcast 派发,
/// 前端按 `event.id == submission.id` 过滤出属于本次 turn 的事件。
///
/// 投递前做插件 slash 命令展开(`/plugin:ns:name args` → 命令正文 +
/// `source_command` 标注;未命中透传,详见 `state/plugins.rs`)。
pub(crate) async fn submit(
    agent: &MinimalAgent,
    submission: reflect_protocol::Submission,
) -> anyhow::Result<()> {
    // 0. 必须先 install_agent_thread。
    let thread = current_thread(agent)?;
    // 插件挂载可能耗时；等待时不占用会话切换锁，切换或关闭可取消等待。
    if matches!(submission.op, reflect_protocol::Op::UserInput { .. }) {
        agent.wait_for_plugins(&thread).await?;
    }
    let _transition = agent.inner.session_transition_lock.lock().await;
    ensure_current_thread(agent, &thread)?;
    if matches!(submission.op, reflect_protocol::Op::UserInput { .. }) {
        ensure_workspace_matches(
            &thread.config().current_workspace(),
            &agent.workspace(),
            submission.workspace.as_deref(),
        )?;
    }

    // 0.5 插件命令在当前线程挂载完成后展开。
    let submission = super::plugins::expand_submission(&agent.plugin_runtime(), submission).await?;

    // 0.6 OS 沙箱策略:按**后端**配置快照盖到本轮的 thread_settings。
    let submission = stamp_sandbox_policy(agent, submission);

    // 1. 拿 per-turn handle。
    let mut handle: reflect_core::TurnHandle = thread.submit(submission.clone()).await;
    if matches!(submission.op, reflect_protocol::Op::Shutdown) {
        // 在释放切换锁前标记关闭，阻止 Shutdown 排队后的提交被静默丢弃。
        thread.cancel_token().cancel();
    }

    // 2. spawn 转发:这个 turn 的所有 event 进 broadcast。
    let inner = agent.inner.clone();
    let sub_id = submission.id.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = handle.next().await {
            super::session::publish_if_current(&inner, &thread, event);
        }
        tracing::debug!("[reflect-gui] turn {} forwarder closed", sub_id);
    });

    Ok(())
}

/// 投递一个非 `UserInput` 的 `Op`(compact / rewind / approval / plan / effort /
/// permission / ask_user 等)。自动生成 submission id(EVENT_ID_NONE 级别的
/// 生命周期 op 不需要前端 pairing,但审批/ask_user 的 id 与 pending 事件 id 对齐)。
///
/// 供 `commands/mod.rs` 的 12 个 Op 命令统一调用。
pub(crate) async fn submit_op(
    agent: &MinimalAgent,
    op: reflect_protocol::Op,
) -> anyhow::Result<String> {
    let thread = current_thread(agent)?;
    let _transition = agent.inner.session_transition_lock.lock().await;
    ensure_current_thread(agent, &thread)?;
    if matches!(op, reflect_protocol::Op::Steer { .. }) {
        ensure_workspace_matches(
            &thread.config().current_workspace(),
            &agent.workspace(),
            None,
        )?;
    }
    let shutdown = matches!(op, reflect_protocol::Op::Shutdown);
    let submission = reflect_protocol::Submission::with_id(uuid::Uuid::new_v4().to_string(), op);
    let id = submission.id.clone();
    // 这类 op 通常无 per-turn 流式输出(审批/effort/permission 立即生效),
    // 但仍走 submit 以保持生命周期事件(SessionConfigured / PermissionModeChanged 等)
    // 的 fan-out 一致性。
    let mut handle = thread.submit(submission).await;
    if shutdown {
        thread.cancel_token().cancel();
    }
    let inner = agent.inner.clone();
    let sub_id = id.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = handle.next().await {
            super::session::publish_if_current(&inner, &thread, event);
        }
        tracing::debug!("[reflect-gui] op turn {} forwarder closed", sub_id);
    });
    Ok(id)
}

/// 把当前生效的 OS 沙箱策略盖到本轮的 `thread_settings` 上。
///
/// 核心在 `submission_loop` 里把 `thread_settings.sandbox_policy` 映射成
/// `ToolContext.os_sandbox`（`OsSandbox` = 开 OS 层，其余 = 关 OS 层），
/// 前台 `BashTool` 与后台 bash 两条路径都读它 —— 比改进程 env 干净
/// （Rust 2024 下 `std::env::set_var` 是 `unsafe`，多线程进程里改 env
/// 有 UB 风险），且天然按轮生效、配置改动下一轮即生效。
///
/// 桌面端**无条件覆盖**客户端传来的 `sandbox_policy`：沙箱是安全设置，
/// 事实源只能是后端的配置快照，不能由客户端决定。
///
/// 仅 `Op::UserInput` 会真正执行工具，其余 op 不带 `thread_settings`，
/// 保持原样。
fn stamp_sandbox_policy(
    agent: &MinimalAgent,
    submission: reflect_protocol::Submission,
) -> reflect_protocol::Submission {
    // load/save 两条路径都已把 os_level 归一成 Some(有效值);
    // unwrap_or(true) 兜底 = 核心基线(默认要求 OS sandbox)。
    let cfg_os_level = agent.cfg().read().sandbox.os_level.unwrap_or(true);
    let enabled = super::sandbox::effective_os_sandbox_enabled(cfg_os_level);
    stamp_sandbox_policy_with(enabled, submission)
}

/// 纯函数版:给定生效开关,盖上对应的协议策略。
fn stamp_sandbox_policy_with(
    enabled: bool,
    submission: reflect_protocol::Submission,
) -> reflect_protocol::Submission {
    let policy = reflect_app_core::sandbox::sandbox_policy_for(enabled);
    let mut submission = submission;
    if let reflect_protocol::Op::UserInput {
        thread_settings, ..
    } = &mut submission.op
    {
        thread_settings.sandbox_policy = Some(policy);
    }
    submission
}

/// 中断当前 turn —— 调用 AgentThread 的 cancel token。
/// CancellationToken 的 cancel 是幂等的,重复调用安全。
/// 中断**当前回合**(不是整个会话)。
///
/// ⚠️ 此前直接取消**会话级** cancel token —— 那是 `Op::Shutdown` 的语义:
/// 会话令牌是所有回合令牌的**父**,取消它会级联取消在飞回合,但**会话
/// 也就此报废** —— 之后每一次提交都会被立刻取消(回合令牌是
/// `cancel.child_token()`,父已取消 → 子一出生就是取消态)。
///
/// 后果实测(L6 实模型演练层):一次中断之后,同一进程里的后续回合**全部
/// 立刻死掉**。
///
/// 正确做法是提交 `Op::Interrupt` —— 核心按**回合**粒度取消在飞回合的
/// 令牌(`active_turns` 表),会话本身不受影响。
pub(crate) async fn interrupt(agent: &MinimalAgent) -> anyhow::Result<String> {
    submit_op(agent, reflect_protocol::Op::Interrupt { child_id: None }).await
}

#[cfg(test)]
mod tests {
    use crate::state::MinimalAgent;
    use reflect_protocol::{Op, Submission, ThreadSettingsOverrides};

    /// UserInput 的 submission,带空 thread_settings。
    fn user_input_submission() -> Submission {
        Submission::with_id(
            "s1",
            Op::UserInput {
                items: vec![],
                thread_settings: ThreadSettingsOverrides::default(),
            },
        )
    }

    #[test]
    fn workspace_mismatch_rejects_stale_or_inconsistent_submissions() {
        use std::path::Path;
        let original = Path::new("/project/one");
        let other = Path::new("/project/two");
        assert!(super::ensure_workspace_matches(original, original, Some("/project/one")).is_ok());
        assert!(super::ensure_workspace_matches(original, other, None).is_err());
        assert!(super::ensure_workspace_matches(original, original, Some("/project/two")).is_err());
    }

    #[tokio::test]
    async fn queued_submissions_reject_a_replaced_thread() {
        let agent = MinimalAgent::new_empty();
        *agent.inner.cfg.write() = reflect_config::ReflectConfig::default();
        agent.install_agent_thread().await;
        let transition = agent.inner.session_transition_lock.lock().await;

        let user = super::submit(&agent, user_input_submission());
        let op = super::submit_op(&agent, Op::Compact);
        tokio::pin!(user, op);
        assert!(futures::poll!(&mut user).is_pending());
        assert!(futures::poll!(&mut op).is_pending());

        super::super::rebind::rebind_session(
            &agent,
            reflect_protocol::ThreadId::new(),
            vec![],
            None,
        )
        .unwrap();
        drop(transition);
        assert!(
            user.await
                .unwrap_err()
                .to_string()
                .contains("session changed")
        );
        assert!(
            op.await
                .unwrap_err()
                .to_string()
                .contains("session changed")
        );
    }

    #[tokio::test]
    async fn pending_plugin_mount_does_not_block_session_switch() {
        let agent = MinimalAgent::new_empty();
        *agent.inner.cfg.write() = reflect_config::ReflectConfig::default();
        agent.install_agent_thread().await;
        let mount = agent.inner.plugin_mount_lock.lock().await;
        super::super::rebind::rebind_session(
            &agent,
            reflect_protocol::ThreadId::new(),
            vec![],
            None,
        )
        .unwrap();
        let pending = super::submit(&agent, user_input_submission());
        tokio::pin!(pending);
        assert!(futures::poll!(&mut pending).is_pending());
        let transition = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            agent.inner.session_transition_lock.lock(),
        )
        .await
        .expect("plugin wait must not hold the transition lock");
        super::super::rebind::rebind_session(
            &agent,
            reflect_protocol::ThreadId::new(),
            vec![],
            None,
        )
        .unwrap();
        drop(transition);
        let error = tokio::time::timeout(std::time::Duration::from_secs(2), pending)
            .await
            .unwrap()
            .unwrap_err();
        assert!(
            error.to_string().contains("session closed")
                || error.to_string().contains("plugin mount ended")
        );
        drop(mount);
    }

    #[tokio::test]
    async fn closed_thread_rejects_submissions_and_can_be_rebound() {
        let agent = MinimalAgent::new_empty();
        *agent.inner.cfg.write() = reflect_config::ReflectConfig::default();
        agent.install_agent_thread().await;
        let sid = reflect_protocol::ThreadId::new();
        super::super::rebind::rebind_session(&agent, sid, vec![], None).unwrap();
        let old = super::current_thread(&agent).unwrap();
        super::submit_op(&agent, Op::Shutdown).await.unwrap();
        assert!(old.cancel_token().is_cancelled());
        assert!(
            super::submit(&agent, user_input_submission())
                .await
                .is_err()
        );
        assert!(super::submit_op(&agent, Op::Compact).await.is_err());
        super::super::rebind::rebind_session(&agent, sid, vec![], None).unwrap();
        let current = super::current_thread(&agent).unwrap();
        assert!(!std::sync::Arc::ptr_eq(&old, &current));
        assert!(!current.cancel_token().is_cancelled());
    }

    /// 取 submission 上的 sandbox_policy。
    fn policy_of(sub: &Submission) -> Option<reflect_protocol::SandboxPolicy> {
        match &sub.op {
            Op::UserInput {
                thread_settings, ..
            } => thread_settings.sandbox_policy,
            _ => None,
        }
    }

    /// 沙箱开启 → 每轮下发 `OsSandbox`(核心映射为 `ctx.os_sandbox = Some(true)`)。
    #[test]
    fn stamps_os_sandbox_policy_when_enabled() {
        let sub = super::stamp_sandbox_policy_with(true, user_input_submission());
        assert_eq!(
            policy_of(&sub),
            Some(reflect_protocol::SandboxPolicy::OsSandbox)
        );
    }

    /// 沙箱关闭 → 每轮下发 `WorkspaceOnly`(核心映射为 `ctx.os_sandbox = Some(false)`)。
    #[test]
    fn stamps_workspace_only_policy_when_disabled() {
        let sub = super::stamp_sandbox_policy_with(false, user_input_submission());
        assert_eq!(
            policy_of(&sub),
            Some(reflect_protocol::SandboxPolicy::WorkspaceOnly)
        );
    }

    /// 客户端传来的 `sandbox_policy` 必须被**无条件覆盖** —— 沙箱是安全设置,
    /// 事实源只能是后端配置快照,不能由客户端决定。
    #[test]
    fn overrides_client_supplied_policy() {
        let sub = Submission::with_id(
            "s1",
            Op::UserInput {
                items: vec![],
                thread_settings: ThreadSettingsOverrides {
                    sandbox_policy: Some(reflect_protocol::SandboxPolicy::FullAccess),
                    ..Default::default()
                },
            },
        );
        let stamped = super::stamp_sandbox_policy_with(true, sub);
        assert_eq!(
            policy_of(&stamped),
            Some(reflect_protocol::SandboxPolicy::OsSandbox),
            "客户端指定的策略必须被后端配置覆盖"
        );
    }

    /// 非 UserInput 的 op 不带 thread_settings —— 原样透传。
    #[test]
    fn non_user_input_ops_are_untouched() {
        let sub = Submission::with_id("s1", Op::Compact);
        let stamped = super::stamp_sandbox_policy_with(false, sub);
        assert!(matches!(stamped.op, Op::Compact));
    }

    /// submit_op 在未 install 时必须返回 Err(instead of panic)。
    /// 这是 AGENTS.md「修复根因，而非打补丁」的体现:
    /// commands 层依赖此错误路径,前端会展示为 toast。
    #[tokio::test]
    async fn submit_op_returns_err_when_not_installed() {
        let agent = MinimalAgent::new_empty();
        let result = agent.submit_op(reflect_protocol::Op::Compact).await;
        assert!(
            result.is_err(),
            "submit_op before install must error, got: {result:?}"
        );
        let err_msg = format!("{}", result.unwrap_err());
        assert!(
            err_msg.contains("not installed") || err_msg.contains("setup"),
            "error message must explain root cause: {err_msg}"
        );
    }
}
