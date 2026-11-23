//! 推理强度(effort)命令 —— `Op::SetEffort` 桥接 + 当前档位回读。
//!
//! 从 `commands/agent.rs` 分出:agent.rs 顶到文件大小预算上限,而 effort
//! 是独立的用户设置域(Composer 控件 / `/effort` slash / Models 视图三处
//! UI 消费),值得自己的模块。

use serde::Serialize;
use tauri::State;

use zhuye_protocol::{Op, ReasoningEffortMirror};

use crate::commands::error::{CommandError, CommandResult};
use crate::state::MinimalAgent;

/// 设置 reasoning effort(前端 Composer 控件 / `/effort` slash 发起)。
///
/// wire 上 `level` 是字符串,这里转成 `ReasoningEffortMirror`。
#[tauri::command]
pub async fn zhuye_set_effort(
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
pub async fn zhuye_get_effort(agent: State<'_, MinimalAgent>) -> CommandResult<String> {
    let guard = agent.inner.thread.lock();
    let Some(thread) = guard.as_ref() else {
        return Ok("low".to_string());
    };
    Ok(match thread.config().current_effort() {
        ReasoningEffortMirror::Low => "low",
        ReasoningEffortMirror::Medium => "medium",
        ReasoningEffortMirror::High => "high",
        ReasoningEffortMirror::XHigh => "xhigh",
        ReasoningEffortMirror::Max => "max",
        ReasoningEffortMirror::Ultra => "ultra",
    }
    .to_string())
}

/// `"low"|"medium"|"high"|"xhigh"|"max"|"ultra"` → `ReasoningEffortMirror`
/// (上游 v1.x 起新增 max / ultra 档,fix/effort-xhigh-ladder 新增 xhigh 档,
/// 按模型能力表在发送前钳制)。
fn parse_effort(s: &str) -> CommandResult<ReasoningEffortMirror> {
    Ok(match s.to_ascii_lowercase().as_str() {
        "low" => ReasoningEffortMirror::Low,
        "medium" => ReasoningEffortMirror::Medium,
        "high" => ReasoningEffortMirror::High,
        "xhigh" => ReasoningEffortMirror::XHigh,
        "max" => ReasoningEffortMirror::Max,
        "ultra" => ReasoningEffortMirror::Ultra,
        other => {
            return Err(CommandError {
                msg: format!("invalid effort '{other}'; expected low|medium|high|xhigh|max|ultra"),
            });
        }
    })
}

/// 思考强度能力快照 —— 「当前模型能选哪些档」「用户选的档实际生效为什么」。
///
/// 能力来源:静态能力表(上游 `reasoning_effort` 模块;已知模型族
/// qwen→…/high、qwen3.8→…/xhigh、deepseek→…/max、OpenAI 推理系→…/ultra,
/// 未知模型保守到 high)。「运行时已验证结论」层待上游合入后叠加。
#[derive(Debug, Clone, Serialize)]
pub struct EffortCapability {
    /// 当前模型 spec(`<模型组id>/<model>`);未配置模型时为空串。
    pub model: String,
    /// 已知支持的档位;`known = false` 时为空数组(能力未知)。
    pub supported: Vec<String>,
    /// 能力是否已知。`false` = 未知(不等于不支持)。
    pub known: bool,
    /// 用户选择的档位(会话槽位里的原始偏好)。
    pub requested: String,
    /// 按当前模型算出的生效档位;`None` = 完全不发思考参数。
    pub effective: Option<String>,
    /// 生效档位与用户选择不一致(被模型能力钳制过)。
    pub adjusted: bool,
}

/// 读当前会话的思考强度能力快照(Composer / Models 两处共用一份口径)。
///
/// 前端据此决定**能选哪些档**,并把「用户选择」与「实际生效」分开显示 ——
/// 用户偏好始终保留,换模型后自动按新模型重算。
///
/// 能力来源:静态能力表(`zhuye_llm::reasoning_effort`,v1.10 功能4)——
/// 与引擎发 wire 前的实际钳制**同一份函数**,UI 展示与引擎行为天然一致。
/// 「运行时已验证结论」层(按端点 + 模型隔离的 effort_cache)依赖的上游
/// 提交尚未合入 ZhuYe,待上游提供后在此叠加为第一优先级。
#[tauri::command]
pub async fn zhuye_effort_capability(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<EffortCapability> {
    // 当前模型 spec(钳制按完整 spec 归一化,引擎侧同口径)。
    let cfg_arc = agent.cfg();
    let model = cfg_arc.read().resolved_model_spec().unwrap_or_default();
    drop(cfg_arc);

    // 用户选择的档位(线程未安装时回落 low)。
    let requested = {
        let guard = agent.inner.thread.lock();
        match guard.as_ref() {
            Some(thread) => thread.config().current_effort(),
            None => ReasoningEffortMirror::Low,
        }
    };
    let desired = zhuye_llm::ReasoningEffort::from(requested);

    // 静态能力表:支持档位阶梯 + 与引擎一致的钳制结果。未知模型走上游
    // 保守默认(Low..=High),与引擎实际会发出的档位严格一致。
    let supported: Vec<String> = zhuye_llm::reasoning_effort::supported_efforts_for_model(&model)
        .iter()
        .map(|level| zhuye_llm::reasoning_effort::effort_wire_str(*level).to_string())
        .collect();
    let effective = zhuye_llm::reasoning_effort::clamp_effort_for_model(desired, &model);

    Ok(EffortCapability {
        supported,
        known: true,
        requested: effort_name(requested).to_string(),
        effective: Some(zhuye_llm::reasoning_effort::effort_wire_str(effective).to_string()),
        adjusted: effective != desired,
        model,
    })
}

/// 协议档位 → wire 字符串。
fn effort_name(effort: ReasoningEffortMirror) -> &'static str {
    match effort {
        ReasoningEffortMirror::Low => "low",
        ReasoningEffortMirror::Medium => "medium",
        ReasoningEffortMirror::High => "high",
        ReasoningEffortMirror::XHigh => "xhigh",
        ReasoningEffortMirror::Max => "max",
        ReasoningEffortMirror::Ultra => "ultra",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_effort_round_trip() {
        assert_eq!(parse_effort("low").unwrap(), ReasoningEffortMirror::Low);
        assert_eq!(
            parse_effort("Medium").unwrap(),
            ReasoningEffortMirror::Medium
        );
        assert_eq!(parse_effort("HIGH").unwrap(), ReasoningEffortMirror::High);
        // 上游 v1.x 新档位:max / ultra;fix/effort-xhigh-ladder 新增 xhigh。
        assert_eq!(parse_effort("xhigh").unwrap(), ReasoningEffortMirror::XHigh);
        assert_eq!(parse_effort("XHIGH").unwrap(), ReasoningEffortMirror::XHigh);
        assert_eq!(parse_effort("max").unwrap(), ReasoningEffortMirror::Max);
        assert_eq!(parse_effort("ULTRA").unwrap(), ReasoningEffortMirror::Ultra);
        assert!(parse_effort("nope").is_err());
    }
}
