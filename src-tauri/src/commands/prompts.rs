//! 会话提示词选择、重扫和正文预览命令。

use serde::{Deserialize, Serialize};
use tauri::State;
use zhuye_protocol::{Op, PromptAction};

use super::CommandResult;
use crate::state::MinimalAgent;

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
/// 与 [`zhuye_prompt_command`] 的 `list` 动作互补:后者只报**层文件名**
/// (哪些层命中了),本命令报**层解析后的正文** —— 即模型真正吃到的那段
/// 提示词。用户在 GUI 里就能核对「agent 到底被喂了什么」。
#[tauri::command]
pub async fn zhuye_get_effective_prompt(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<EffectivePrompt> {
    let model = agent.model_spec();
    let thread = agent.inner.thread.lock().clone();
    let set = thread
        .as_ref()
        .map(|thread| thread.config().resolve_prompt(&model).set)
        .unwrap_or_else(|| {
            zhuye_prompt::PromptLibrary::embedded()
                .resolve_selection(&model, &zhuye_protocol::PromptSelection::Default)
                .set
        });
    let mut sections: Vec<_> = set
        .sections()
        .filter(|(key, _)| key.starts_with("system."))
        .map(|(key, content)| PromptSection {
            key: key.into(),
            content: content.into(),
        })
        .collect();
    if let Some(thread) = thread.as_ref() {
        if let Some(m4) = &thread.config().m4
            && matches!(
                m4.active_agent_def.source,
                zhuye_agent_def::SystemPromptSource::Custom
            )
            && let Some(main) = sections
                .iter_mut()
                .find(|section| section.key == "system.main")
        {
            main.content = m4.active_agent_def.system_prompt.clone();
        }
        let sources = thread.tools().list_with_source();
        for spec in thread.tools().list_specs() {
            let zhuye_tools::ToolSpec::Function {
                name, description, ..
            } = spec;
            let builtin = sources.iter().any(|(source_name, source)| {
                source_name == &name && *source == zhuye_tools::ToolSource::Builtin
            });
            let key = format!("tool.{name}");
            let content = if builtin {
                set.get_or(&key, &description)
            } else {
                &description
            };
            sections.push(PromptSection {
                key,
                content: content.to_string(),
            });
        }
    }
    sections.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(EffectivePrompt {
        model,
        layers: set.layers,
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
pub async fn zhuye_prompt_command(
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

        let selection: PromptAction = serde_json::from_str(
            r#"{"type":"select","selection":{"mode":"manual","profile":"gpt"}}"#,
        )
        .unwrap();
        assert!(matches!(
            selection,
            PromptAction::Select {
                selection: Some(zhuye_protocol::PromptSelection::Manual { profile })
            } if profile == "gpt"
        ));

        let save: PromptAction =
            serde_json::from_str(r#"{"type":"save_default","selection":{"mode":"auto"}}"#).unwrap();
        assert!(matches!(
            save,
            PromptAction::SaveDefault {
                selection: zhuye_protocol::PromptSelection::Auto
            }
        ));
    }
}
