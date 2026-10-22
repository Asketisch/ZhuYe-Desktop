//! 目标模式命令面(v1.2 P1,reflect-goal 编排)。
//!
//! 三个命令构成完整的一组:进入 / 退出 / **查状态**。
//!
//! 目标模式**没有协议事件**(上游如此)—— 所以「状态」不能等事件,只能
//! 直接读线程侧的权威值。`reflect_goal_status` 读的是上游
//! `GoalController::snapshot()`(会话级共享槽里的 `GoalState`),
//! 而不是前端投影。

use tauri::State;

use reflect_protocol::Op;

use crate::commands::error::CommandResult;
use crate::state::MinimalAgent;

/// 进入目标模式:`Op::EnterGoalMode`。core 侧构造 `GoalController`,
/// 后续每轮 turn 结束自校验,未完成则 steering 续作,完成则退出。
///
/// 前端 invoke 形态:`invoke<string>('reflect_enter_goal_mode', { goal, verifyCommand?, tokenBudget? })`。
#[tauri::command]
pub async fn reflect_enter_goal_mode(
    agent: State<'_, MinimalAgent>,
    goal: String,
    verify_command: Option<String>,
    token_budget: Option<u64>,
) -> CommandResult<String> {
    Ok(agent
        .submit_op(Op::EnterGoalMode {
            goal,
            verify_command,
            token_budget,
        })
        .await?)
}

/// 退出目标模式:`Op::ExitGoalMode`,停止自动续作。
#[tauri::command]
pub async fn reflect_exit_goal_mode(agent: State<'_, MinimalAgent>) -> CommandResult<String> {
    Ok(agent.submit_op(Op::ExitGoalMode).await?)
}

/// 查询目标模式的**权威状态** —— 跑到第几轮 / LM 判定 / 累计 token /
/// 被什么卡住。
///
/// 此前 GUI 只能靠前端投影(`goalActive: boolean`)猜「目标模式是否活跃」
/// —— 协议没有 goal 事件,投影在会话切换 / 后端 rebind 后就会与真实状态
/// 脱节。上游补了 `GoalController::snapshot()` + 会话级共享槽后,这里
/// 直接读线程侧的权威值。
///
/// 返回 `null` = 没有活跃目标(未进目标模式 / 已退出 / 已到终态被清空)。
///
/// 前端 invoke 形态:`invoke<GoalState|null>('reflect_goal_status', {})`。
#[tauri::command]
pub async fn reflect_goal_status(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<Option<serde_json::Value>> {
    let snapshot = agent.goal_snapshot();
    Ok(snapshot.map(|s| serde_json::to_value(s).unwrap_or(serde_json::Value::Null)))
}
