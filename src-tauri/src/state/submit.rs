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
    let thread = {
        let guard = agent.inner.thread.lock();
        guard
            .clone()
            .ok_or_else(|| anyhow::anyhow!("agent thread not installed yet; setup not complete"))?
    };

    // 0.5 插件命令展开:挂载完成前直通,不阻塞提交。
    let submission = super::plugins::expand_submission(&agent.plugin_runtime(), submission).await?;

    // 0.6 OS 沙箱策略:按**后端**配置快照盖到本轮的 thread_settings。
    let submission = stamp_sandbox_policy(agent, submission);

    // 1. 拿 per-turn handle。
    let mut handle: reflect_core::TurnHandle = thread.submit(submission.clone()).await;

    // 2. spawn 转发:这个 turn 的所有 event 进 broadcast。
    let session_tx = agent.inner.session_tx.clone();
    let sub_id = submission.id.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = handle.next().await {
            if session_tx.send(event).is_err() {
                tracing::debug!("[reflect-gui] no subscribers for turn {}", sub_id);
            }
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
    let thread = {
        let guard = agent.inner.thread.lock();
        guard
            .clone()
            .ok_or_else(|| anyhow::anyhow!("agent thread not installed yet; setup not complete"))?
    };
    let submission = reflect_protocol::Submission::with_id(uuid::Uuid::new_v4().to_string(), op);
    let id = submission.id.clone();
    // 这类 op 通常无 per-turn 流式输出(审批/effort/permission 立即生效),
    // 但仍走 submit 以保持生命周期事件(SessionConfigured / PermissionModeChanged 等)
    // 的 fan-out 一致性。
    let mut handle = thread.submit(submission).await;
    let session_tx = agent.inner.session_tx.clone();
    let sub_id = id.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = handle.next().await {
            let _ = session_tx.send(event);
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
