//! 核心 agent 桥接:`reflect_submit` / `reflect_interrupt` + 14 个 Op 命令。
//!
//! 每个 Op 命令构造一个 `Op`,经 `MinimalAgent::submit_op` 真正驱动 `AgentThread`。

use tauri::State;

use reflect_protocol::{
    AskUserAnswer, Op, PermissionMode, ReasoningEffortMirror, SteeringPriorityMirror, Submission,
    UserInputItem,
};

use crate::commands::error::{CommandError, CommandResult};
use crate::state::MinimalAgent;

// ====== 核心:用户提交 + 中断 ======

/// 把 Submission 通过 MinimalAgent 发送到后端。返回 submission.id。
///
/// 前端 invoke 形态:`invoke<string>('reflect_submit', { submission })`。
///
/// 图片附件归一:前端 Composer 把图片读成 data-URL(base64)字符串,而协议
/// `UserInputItem::Image.data` 是 `Vec<u8>`(serde 要求数字数组)。这里在
/// 应用层把 `type:"image"` 条目的字符串 data(data-URL 或裸 base64)解码成
/// 字节数组,再做 serde 反序列化——线格式保持紧凑,协议层不动。
#[tauri::command]
pub async fn reflect_submit(
    agent: State<'_, MinimalAgent>,
    submission: serde_json::Value,
) -> CommandResult<String> {
    let submission = normalize_image_data(submission)?;
    let submission: Submission = serde_json::from_value(submission).map_err(|e| CommandError {
        msg: format!("invalid submission: {e}"),
    })?;
    let id = submission.id.clone();
    agent.submit(submission).await?;
    Ok(id)
}

/// 递归归一 submission 里所有 image 条目的 data 字段:
/// `data:<mime>;base64,<payload>` 或裸 base64 → 解码为字节数组。
/// 已是数组的 data 原样保留。
fn normalize_image_data(v: serde_json::Value) -> CommandResult<serde_json::Value> {
    use serde_json::Value;
    match v {
        Value::Object(mut map) => {
            if map.get("type").and_then(|t| t.as_str()) == Some("image") {
                if let Some(Value::String(s)) = map.get("data") {
                    // data-URL(`data:<mime>;base64,<payload>`)取最后一个逗号后的
                    // payload;裸 base64 原样使用。
                    let payload = if s.starts_with("data:") {
                        s.rsplit(',').next().unwrap_or(s)
                    } else {
                        s
                    };
                    let bytes = base64_decode(payload).ok_or_else(|| CommandError {
                        msg: "invalid base64 in image attachment".into(),
                    })?;
                    map.insert(
                        "data".into(),
                        Value::Array(bytes.into_iter().map(Value::from).collect()),
                    );
                }
            }
            // 无论是否 image 条目都继续下钻(兼容嵌套结构变化)。
            for (_, val) in map.iter_mut() {
                let taken = std::mem::replace(val, Value::Null);
                *val = normalize_image_data(taken)?;
            }
            Ok(Value::Object(map))
        }
        Value::Array(arr) => {
            let mut out = Vec::with_capacity(arr.len());
            for item in arr {
                out.push(normalize_image_data(item)?);
            }
            Ok(Value::Array(out))
        }
        other => Ok(other),
    }
}

/// 小型 base64 解码器(与 reflect-llm 内手写编码器配对;src-tauri 无 base64 依赖)。
fn base64_decode(input: &str) -> Option<Vec<u8>> {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut rev = [255u8; 256];
    for (i, &c) in ALPHABET.iter().enumerate() {
        rev[c as usize] = i as u8;
    }
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;
    let mut out = Vec::with_capacity(input.len() / 4 * 3);
    for ch in input.bytes() {
        if ch == b'=' || ch == b'\n' || ch == b'\r' {
            continue;
        }
        let v = rev[ch as usize];
        if v == 255 {
            return None; // 非法字符
        }
        acc = (acc << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Some(out)
}

#[tauri::command]
pub async fn reflect_interrupt(agent: State<'_, MinimalAgent>) -> CommandResult<String> {
    Ok(agent.interrupt().await?)
}

// ====== 14 个 Op 命令:构造 Op 经 submit_op 真正驱动 AgentThread ======

#[tauri::command]
pub async fn reflect_compact(agent: State<'_, MinimalAgent>) -> CommandResult<String> {
    Ok(agent.submit_op(Op::Compact).await?)
}

#[tauri::command]
pub async fn reflect_rewind(
    agent: State<'_, MinimalAgent>,
    to_turn_id: Option<String>,
) -> CommandResult<String> {
    Ok(agent.submit_op(Op::Rewind { to_turn_id }).await?)
}

#[tauri::command]
pub async fn reflect_shutdown(agent: State<'_, MinimalAgent>) -> CommandResult<String> {
    Ok(agent.submit_op(Op::Shutdown).await?)
}

#[tauri::command]
pub async fn reflect_tool_approval(
    agent: State<'_, MinimalAgent>,
    id: String,
    decision: ReviewDecision,
) -> CommandResult<String> {
    Ok(agent.submit_op(Op::ToolApproval { id, decision }).await?)
}

#[tauri::command]
pub async fn reflect_hook_approval(
    agent: State<'_, MinimalAgent>,
    id: String,
    decision: ReviewDecision,
) -> CommandResult<String> {
    Ok(agent.submit_op(Op::HookApproval { id, decision }).await?)
}

#[tauri::command]
pub async fn reflect_enter_plan_mode(
    agent: State<'_, MinimalAgent>,
    task: String,
) -> CommandResult<String> {
    Ok(agent.submit_op(Op::EnterPlanMode { task }).await?)
}

#[tauri::command]
pub async fn reflect_exit_plan_mode(agent: State<'_, MinimalAgent>) -> CommandResult<String> {
    Ok(agent.submit_op(Op::ExitPlanMode).await?)
}

#[tauri::command]
pub async fn reflect_plan_approval(
    agent: State<'_, MinimalAgent>,
    id: String,
    choice: PlanApprovalChoice,
) -> CommandResult<String> {
    Ok(agent.submit_op(Op::PlanApproval { id, choice }).await?)
}

/// 设置 reasoning effort。前端传字符串 `"low"|"medium"|"high"`,
/// 这里转成 `ReasoningEffortMirror`。
#[tauri::command]
pub async fn reflect_set_effort(
    agent: State<'_, MinimalAgent>,
    level: String,
) -> CommandResult<String> {
    let effort = parse_effort(&level)?;
    Ok(agent.submit_op(Op::SetEffort { effort }).await?)
}

/// 读回当前 reasoning effort(`AgentConfig::current_effort`,协议无对应
/// 回读事件,这里从线程内槽直读)。前端 Composer/Models 控件初始化用。
/// 线程未安装(pre-install)时回落默认 `low`。
#[tauri::command]
pub async fn reflect_get_effort(agent: State<'_, MinimalAgent>) -> CommandResult<String> {
    let guard = agent.inner.thread.lock();
    let Some(thread) = guard.as_ref() else {
        return Ok("low".to_string());
    };
    Ok(match thread.config().current_effort() {
        ReasoningEffortMirror::Low => "low",
        ReasoningEffortMirror::Medium => "medium",
        ReasoningEffortMirror::High => "high",
    }
    .to_string())
}

#[tauri::command]
pub async fn reflect_ask_user_question_response(
    agent: State<'_, MinimalAgent>,
    id: String,
    answers: serde_json::Value,
) -> CommandResult<String> {
    // 前端传 JSON,这里反序列化成 AskUserAnswer(结构化)。
    let answers: AskUserAnswer = serde_json::from_value(answers).map_err(|e| CommandError {
        msg: format!("invalid answers: {e}"),
    })?;
    Ok(agent
        .submit_op(Op::AskUserQuestionResponse { id, answers })
        .await?)
}

#[tauri::command]
pub async fn reflect_ask_user_input_response(
    agent: State<'_, MinimalAgent>,
    id: String,
    text: String,
) -> CommandResult<String> {
    Ok(agent
        .submit_op(Op::AskUserInputResponse { id, text })
        .await?)
}

#[tauri::command]
pub async fn reflect_set_permission_mode(
    agent: State<'_, MinimalAgent>,
    mode: String,
) -> CommandResult<String> {
    let mode = parse_permission_mode(&mode)?;
    Ok(agent.submit_op(Op::SetPermissionMode { mode }).await?)
}

#[tauri::command]
pub async fn reflect_cycle_permission_mode(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<String> {
    Ok(agent.submit_op(Op::CyclePermissionMode).await?)
}

/// v1.4 A2:回合中途转向 —— 不打断当前 turn,消息进会话转向队列,由
/// 正在跑的 turn 在下一个 pre_loop 安全点收割注入;无在飞 turn 时随
/// 下一个 UserInput turn 边界合并。应答只有 submission id,注入本身
/// 不发协议事件(仅落 recorder),GUI 需乐观渲染。
///
/// 前端 invoke 形态:`invoke<string>('reflect_steer', { items, priority? })`。
/// items 与 Submission 的 UserInputItem 同形(图片可能带 data-URL 字符串,
/// 复用 `normalize_image_data` 归一);priority:`"now"`(用户中途说话,
/// 直入上下文)或 `"attachment"`(参考资料,system-reminder 包裹;缺省)。
#[tauri::command]
pub async fn reflect_steer(
    agent: State<'_, MinimalAgent>,
    items: serde_json::Value,
    priority: Option<String>,
) -> CommandResult<String> {
    let items = normalize_image_data(items)?;
    let items: Vec<UserInputItem> = serde_json::from_value(items).map_err(|e| CommandError {
        msg: format!("invalid steer items: {e}"),
    })?;
    let priority = match priority.as_deref() {
        None | Some("") => SteeringPriorityMirror::default(),
        Some(p) => parse_steering_priority(p)?,
    };
    Ok(agent.submit_op(Op::Steer { priority, items }).await?)
}

/// v1.4 C1:查询子代理状态快照。应答为 `subagent_status` 事件,经
/// per-turn 通道 + 会话扇出双路送达(前端走 reflect_event 通道)。
///
/// 前端 invoke 形态:`invoke<string>('reflect_query_subagents', { childId? })`。
#[tauri::command]
pub async fn reflect_query_subagents(
    agent: State<'_, MinimalAgent>,
    child_id: Option<String>,
) -> CommandResult<String> {
    Ok(agent.submit_op(Op::QuerySubagents { child_id }).await?)
}

// ====== 目标模式(v1.2 P1,reflect-goal 编排)======

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

/// 目标模式状态快照(只读):直读 `AgentThread::goal_snapshot()`(上游
/// v1.7 读口)。目标模式没有协议事件,这是「是否活跃 / 第几轮 / LM 判定 /
/// 累计 token」的唯一权威来源;前端投影在会话切换 / rebind 后以此校准。
///
/// 前端 invoke 形态:`invoke<GoalSnapshotPayload | null>('reflect_goal_snapshot')`。
/// 未进入目标模式(或后端 rebind 丢控制器)返回 `null`。
#[tauri::command]
pub async fn reflect_goal_snapshot(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<Option<reflect_goal::GoalState>> {
    let thread = agent.inner.thread.lock().clone();
    Ok(thread.as_ref().and_then(|t| t.goal_snapshot()))
}

// ====== 辅助:字符串 → 强类型 ======

/// `"low"|"medium"|"high"` → `ReasoningEffortMirror`。
pub(crate) fn parse_effort(s: &str) -> CommandResult<ReasoningEffortMirror> {
    Ok(match s.to_ascii_lowercase().as_str() {
        "low" => ReasoningEffortMirror::Low,
        "medium" => ReasoningEffortMirror::Medium,
        "high" => ReasoningEffortMirror::High,
        other => {
            return Err(CommandError {
                msg: format!("invalid effort '{other}'; expected low|medium|high"),
            });
        }
    })
}

/// `"auto"|"prompt"|"deny"|"plan"|"accept_edits"|"bubble"|"bypass"` → `PermissionMode`。
pub(crate) fn parse_permission_mode(s: &str) -> CommandResult<PermissionMode> {
    Ok(match s.to_ascii_lowercase().as_str() {
        "auto" => PermissionMode::Auto,
        "prompt" => PermissionMode::Prompt,
        "deny" => PermissionMode::Deny,
        "plan" => PermissionMode::Plan,
        "accept_edits" => PermissionMode::AcceptEdits,
        "bubble" => PermissionMode::Bubble,
        "bypass" => PermissionMode::Bypass,
        other => {
            return Err(CommandError {
                msg: format!(
                    "invalid permission mode '{other}'; expected auto|prompt|deny|plan|accept_edits|bubble|bypass"
                ),
            });
        }
    })
}

/// `"now"|"attachment"` → `SteeringPriorityMirror`(缺省 attachment:
/// 未显式声明的转向按参考资料处理,保守不冒充直接指令)。
fn parse_steering_priority(s: &str) -> CommandResult<SteeringPriorityMirror> {
    Ok(match s.to_ascii_lowercase().as_str() {
        "now" => SteeringPriorityMirror::Now,
        "attachment" => SteeringPriorityMirror::Attachment,
        other => {
            return Err(CommandError {
                msg: format!("invalid steering priority '{other}'; expected now|attachment"),
            });
        }
    })
}

/// `PermissionMode` → 线格式字符串(`parse_permission_mode` 的逆,
/// 与 reflect-protocol 的 serde snake_case 一致)。`reflect_bind_session`
/// 返回当前会话模式给前端同步用。
pub(crate) fn permission_mode_str(mode: PermissionMode) -> &'static str {
    match mode {
        PermissionMode::Auto => "auto",
        PermissionMode::Prompt => "prompt",
        PermissionMode::Deny => "deny",
        PermissionMode::Plan => "plan",
        PermissionMode::AcceptEdits => "accept_edits",
        PermissionMode::Bubble => "bubble",
        PermissionMode::Bypass => "bypass",
    }
}

use reflect_protocol::{PlanApprovalChoice, ReviewDecision};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_decode_known_vectors() {
        assert_eq!(base64_decode("SGVsbG8="), Some(b"Hello".to_vec()));
        assert_eq!(base64_decode(""), Some(Vec::new()));
        assert_eq!(base64_decode("!!!"), None);
    }

    #[test]
    fn base64_decode_matches_media_encoder() {
        // 与 src-tauri/src/commands/media.rs 的 base64_encode 互逆。
        let bytes = "图片图片".as_bytes();
        let encoded = crate::commands::media::base64_encode(bytes);
        assert_eq!(base64_decode(&encoded), Some(bytes.to_vec()));
    }

    #[test]
    fn normalize_converts_data_url_to_bytes() {
        let v = serde_json::json!({
            "op": { "type": "user_input", "items": [
                { "type": "text", "text": "看图" },
                { "type": "image", "data": "data:image/png;base64,SGVsbG8=", "mime_type": "image/png" },
                { "type": "image", "data": "QQ==", "mime_type": "image/jpeg" }
            ]}
        });
        let out = normalize_image_data(v).unwrap();
        let items = out["op"]["items"].as_array().unwrap();
        assert_eq!(
            items[1]["data"],
            serde_json::json!([72u8, 101, 108, 108, 111])
        );
        assert_eq!(items[2]["data"], serde_json::json!([65u8]));
        assert_eq!(items[0]["text"], "看图");
    }

    #[test]
    fn normalize_rejects_bad_base64() {
        let v = serde_json::json!({ "type": "image", "data": "!!not-base64!!" });
        assert!(normalize_image_data(v).is_err());
    }

    #[test]
    fn parse_effort_round_trip() {
        assert_eq!(parse_effort("low").unwrap(), ReasoningEffortMirror::Low);
        assert_eq!(
            parse_effort("Medium").unwrap(),
            ReasoningEffortMirror::Medium
        );
        assert_eq!(parse_effort("HIGH").unwrap(), ReasoningEffortMirror::High);
        assert!(parse_effort("nope").is_err());
    }

    #[test]
    fn parse_permission_mode_round_trip() {
        assert_eq!(parse_permission_mode("auto").unwrap(), PermissionMode::Auto);
        assert_eq!(
            parse_permission_mode("prompt").unwrap(),
            PermissionMode::Prompt
        );
        assert_eq!(parse_permission_mode("deny").unwrap(), PermissionMode::Deny);
        assert_eq!(parse_permission_mode("plan").unwrap(), PermissionMode::Plan);
        assert_eq!(
            parse_permission_mode("accept_edits").unwrap(),
            PermissionMode::AcceptEdits
        );
        assert_eq!(
            parse_permission_mode("bubble").unwrap(),
            PermissionMode::Bubble
        );
        assert_eq!(
            parse_permission_mode("bypass").unwrap(),
            PermissionMode::Bypass
        );
        assert!(parse_permission_mode("wat").is_err());
    }

    #[test]
    fn parse_steering_priority_round_trip() {
        assert_eq!(
            parse_steering_priority("now").unwrap(),
            SteeringPriorityMirror::Now
        );
        assert_eq!(
            parse_steering_priority("Attachment").unwrap(),
            SteeringPriorityMirror::Attachment
        );
        assert!(parse_steering_priority("urgent").is_err());
    }

    #[test]
    fn review_decision_serde_round_trip() {
        // ReviewDecision 用 #[serde(rename_all = "snake_case")] —— 前端必须传
        // "approve" / "approve_for_session" / {"deny":{"reason":"..."}}。
        let approve = serde_json::from_str::<ReviewDecision>("\"approve\"").unwrap();
        assert!(matches!(approve, ReviewDecision::Approve));
        // deny 是 struct variant,payload 必须是 {"reason":"..."} 嵌套对象。
        let deny =
            serde_json::from_str::<ReviewDecision>(r#"{"deny":{"reason":"too risky"}}"#).unwrap();
        assert!(matches!(deny, ReviewDecision::Deny { .. }));
        // PascalCase 应被拒绝,防止前端误用。
        assert!(serde_json::from_str::<ReviewDecision>("\"Approve\"").is_err());
    }
}
