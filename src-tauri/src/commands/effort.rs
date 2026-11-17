//! 推理强度(effort)命令 —— `Op::SetEffort` 桥接 + 当前档位回读。
//!
//! 从 `commands/agent.rs` 分出:agent.rs 顶到文件大小预算上限,而 effort
//! 是独立的用户设置域(Composer 控件 / `/effort` slash / Models 视图三处
//! UI 消费),值得自己的模块。

use serde::Serialize;
use tauri::State;

use reflect_protocol::{Op, ReasoningEffortMirror};

use crate::commands::error::{CommandError, CommandResult};
use crate::state::MinimalAgent;

/// 设置 reasoning effort(前端 Composer 控件 / `/effort` slash 发起)。
///
/// wire 上 `level` 是字符串,这里转成 `ReasoningEffortMirror`。
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
        ReasoningEffortMirror::Max => "max",
        ReasoningEffortMirror::Ultra => "ultra",
    }
    .to_string())
}

/// `"low"|"medium"|"high"|"max"|"ultra"` → `ReasoningEffortMirror`
/// (上游 v1.x 起新增 max / ultra 档,按模型能力表在发送前钳制)。
fn parse_effort(s: &str) -> CommandResult<ReasoningEffortMirror> {
    Ok(match s.to_ascii_lowercase().as_str() {
        "low" => ReasoningEffortMirror::Low,
        "medium" => ReasoningEffortMirror::Medium,
        "high" => ReasoningEffortMirror::High,
        "max" => ReasoningEffortMirror::Max,
        "ultra" => ReasoningEffortMirror::Ultra,
        other => {
            return Err(CommandError {
                msg: format!("invalid effort '{other}'; expected low|medium|high|max|ultra"),
            });
        }
    })
}

/// 思考强度能力快照 —— 「当前模型能选哪些档」「用户选的档实际生效为什么」。
///
/// 能力来源按优先级:
/// 1. **已验证结论**(引擎在运行时被服务端拒绝后记下的,按端点 + 模型隔离);
/// 2. **能力表**(已知模型族: qwen→low/medium/high、deepseek→…/max、
///    OpenAI 推理系→…/ultra、anthropic 端口→不支持);
/// 3. **未知**(私有模型 / 兼容网关)—— 此时按用户选择原样发送,被拒后
///    引擎会自动降档。
#[derive(Debug, Clone, Serialize)]
pub struct EffortCapability {
    /// 当前模型 spec(`provider/model`);未配置模型时为空串。
    pub model: String,
    /// 已知支持的档位;`known = false` 时为空数组(能力未知)。
    pub supported: Vec<String>,
    /// 能力是否已知。`false` = 未知(不等于不支持)。
    pub known: bool,
    /// 用户选择的档位(会话槽位里的原始偏好)。
    pub requested: String,
    /// 按当前模型算出的生效档位;`None` = 完全不发思考参数。
    pub effective: Option<String>,
    /// 生效档位与用户选择不一致(被模型能力或已验证结论调整过)。
    pub adjusted: bool,
}

/// 读当前会话的思考强度能力快照(Composer / Models 两处共用一份口径)。
///
/// 前端据此决定**能选哪些档**,并把「用户选择」与「实际生效」分开显示 ——
/// 用户偏好始终保留,换模型后自动按新模型重算。
#[tauri::command]
pub async fn reflect_effort_capability(agent: State<'_, MinimalAgent>) -> CommandResult<EffortCapability> {
    // 当前模型 spec + 端点(端点用于查「已验证结论」—— 同一个模型名在不同
    // 兼容网关上的能力可以不同)。
    let cfg_arc = agent.cfg();
    let cfg_guard = cfg_arc.read();
    let model = cfg_guard.resolved_model_spec().unwrap_or_default();
    let endpoint = active_endpoint(&cfg_guard);
    drop(cfg_guard);
    let model_name = model
        .split_once('/')
        .map_or(model.as_str(), |(_, m)| m)
        .to_string();

    // 用户选择的档位(线程未安装时回落 low)。
    let requested = {
        let guard = agent.inner.thread.lock();
        match guard.as_ref() {
            Some(thread) => thread.config().current_effort(),
            None => ReasoningEffortMirror::Low,
        }
    };
    let desired = reflect_llm::ReasoningEffort::from(requested);

    // 能力优先级:运行时已验证结论(按端点 + 模型隔离)> 静态能力表。
    let support = reflect_llm::effort_cache::lookup(&endpoint, &model_name)
        .unwrap_or_else(|| reflect_llm::reasoning_effort::support_for_model(&model));
    let effective = reflect_llm::reasoning_effort::pick_effort(&support, desired);

    Ok(EffortCapability {
        supported: support
            .supported()
            .iter()
            .map(|level| reflect_llm::reasoning_effort::effort_wire_str(*level).to_string())
            .collect(),
        known: support.is_known(),
        requested: effort_name(requested).to_string(),
        effective: effective.map(|level| reflect_llm::reasoning_effort::effort_wire_str(level).to_string()),
        adjusted: effective != Some(desired),
        model,
    })
}

/// 当前生效端点(base_url)—— 能力缓存按它隔离。
///
/// 优先取被钉住凭证条目的 base_url,其次取 provider 段的 base_url;
/// 都没有时回落到 provider 名(此时同 provider 的不同网关共享缓存)。
fn active_endpoint(cfg: &reflect_config::ReflectConfig) -> String {
    let Some(provider) = cfg.active_provider() else {
        return String::new();
    };
    let credential = cfg.active_credential();
    let section = match provider {
        "openai" => cfg.openai.as_ref().map(|s| (s.credentials.as_slice(), s.base_url.clone())),
        "anthropic" => cfg
            .anthropic
            .as_ref()
            .map(|s| (s.credentials.as_slice(), s.base_url.clone())),
        "ollama" => cfg.ollama.as_ref().map(|s| (s.credentials.as_slice(), s.base_url.clone())),
        _ => None,
    };
    let Some((credentials, section_base_url)) = section else {
        return provider.to_string();
    };
    let entry_base = credentials
        .iter()
        .find(|entry| credential.as_deref() == Some(entry.label.as_str()))
        .and_then(|entry| entry.base_url.clone());
    entry_base
        .or(section_base_url)
        .unwrap_or_else(|| provider.to_string())
}

/// 协议档位 → wire 字符串。
fn effort_name(effort: ReasoningEffortMirror) -> &'static str {
    match effort {
        ReasoningEffortMirror::Low => "low",
        ReasoningEffortMirror::Medium => "medium",
        ReasoningEffortMirror::High => "high",
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
        // 上游 v1.x 新档位:max / ultra。
        assert_eq!(parse_effort("max").unwrap(), ReasoningEffortMirror::Max);
        assert_eq!(parse_effort("ULTRA").unwrap(), ReasoningEffortMirror::Ultra);
        assert!(parse_effort("nope").is_err());
    }
}
