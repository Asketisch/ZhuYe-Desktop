//! 提示词层(per-model prompt library)命令面。
//!
//! v1.6.1:提示词按模型自动匹配外置到 `.reflect/prompts/*.md`,引擎侧
//! 经 `Op::PromptCommand` 暴露查询与重扫。桌面端只负责把 Op 递进引擎,
//! 应答事件(`PromptList` / `PromptSwitched`)经单一 `reflect_event`
//! 通道回流给前端 reducer。

use reflect_protocol::{Op, PromptAction};
use serde::{Deserialize, Serialize};
use tauri::State;

use super::CommandResult;
use crate::state::MinimalAgent;

/// 引擎实际引用的 prompt section key。
///
/// 核心的 `PromptSet` 不公开枚举 section key(只给 `get(key)`),因此
/// 这里列出核心 builder / library 真正引用的那几个 —— 覆盖「主 prompt」
/// 「facade prompt」与「plan mode 指引」三种生效形态。
const PROMPT_SECTION_KEYS: &[&str] = &["system.main", "system.facade-main", "system.plan-mode"];

/// 一段生效的 prompt(section key → 正文)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptSection {
    /// section key(如 `system.main`)。
    pub key: String,
    /// section 正文(不含 `##` 标题)。
    pub content: String,
}

/// 当前模型**实际生效**的提示词(按模型匹配后解析的结果)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectivePrompt {
    /// 当前 model spec。
    pub model: String,
    /// 命中的用户层文件名(诊断用,内嵌层不记录)。
    pub layers: Vec<String>,
    /// 生效的 section 列表(缺失的 key 不出现)。
    pub sections: Vec<PromptSection>,
}

/// 查询当前模型实际生效的提示词内容。
///
/// 与 [`reflect_prompt_command`] 的 `list` 动作互补:后者只报**层文件名**
/// (哪些层命中了),本命令报**层解析后的正文** —— 即模型真正吃到的那段
/// 提示词。用户在 GUI 里就能核对「agent 到底被喂了什么」。
#[tauri::command]
pub async fn reflect_get_effective_prompt(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<EffectivePrompt> {
    let model = agent.model_spec();
    let set = reflect_prompt::library().resolve(&model);
    let sections = PROMPT_SECTION_KEYS
        .iter()
        .filter_map(|key| {
            set.get(key).map(|content| PromptSection {
                key: (*key).to_string(),
                content: content.to_string(),
            })
        })
        .collect();
    Ok(EffectivePrompt {
        model,
        layers: set.layers.clone(),
        sections,
    })
}

/// 提示词层查询 / 重扫。
///
/// `action` 是协议内联判别联合(snake_case tag):
/// - `{"type":"list"}` → 引擎应答 `EventMsg::PromptList`(可用层 + 生效层)
/// - `{"type":"switch","layer":null}` → 引擎重扫提示词库,应答
///   `EventMsg::PromptSwitched`(`layer` 槽位预留,当前固定走全量重扫)
///
/// 两个动作都不开 turn;返回的是 submission id,应答走事件通道。
#[tauri::command]
pub async fn reflect_prompt_command(
    agent: State<'_, MinimalAgent>,
    action: PromptAction,
) -> CommandResult<String> {
    Ok(agent.submit_op(Op::PromptCommand { action }).await?)
}

#[cfg(test)]
mod tests {
    //! 线格式锁定测试 —— 前端 `utils/commands/prompts.ts` 直接构造
    //! `{ action: { type: ... } }` 并交给 Tauri 反序列化,形状变了这里
    //! 就会红。

    use super::*;

    #[test]
    fn prompt_action_wire_shape() {
        // list:单位变体 → `{"type":"list"}`。
        let list: PromptAction = serde_json::from_str(r#"{"type":"list"}"#).unwrap();
        assert!(matches!(list, PromptAction::List));
        assert_eq!(serde_json::to_string(&list).unwrap(), r#"{"type":"list"}"#);

        // switch:结构变体 + 可空 layer 槽位 → `{"type":"switch","layer":null}`。
        let switch: PromptAction =
            serde_json::from_str(r#"{"type":"switch","layer":null}"#).unwrap();
        assert!(matches!(switch, PromptAction::Switch { layer: None }));
        assert_eq!(
            serde_json::to_string(&switch).unwrap(),
            r#"{"type":"switch","layer":null}"#
        );

        // 聚焦某层的槽位(未来实装时前端已按此形状构造)。
        let focused: PromptAction =
            serde_json::from_str(r#"{"type":"switch","layer":"claude"}"#).unwrap();
        match focused {
            PromptAction::Switch { layer } => assert_eq!(layer.as_deref(), Some("claude")),
            other => panic!("wrong variant: {other:?}"),
        }
    }
}
