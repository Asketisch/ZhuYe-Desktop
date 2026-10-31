//! 子代理 spec 的列表 / 编辑 —— `call_<role>` 工具的来源。
//!
//! 此前 GUI 里有两套容易混淆的东西:
//! - `~/.zhuye/agents/*.md` —— **agent 定义**(主 agent 的 system prompt /
//!   工具白名单),由 Agents 视图管理;
//! - `~/.zhuye/subagents/*.md` —— **子代理 spec**(`call_<role>` 工具的
//!   来源),**没有任何编辑面**。
//!
//! 合并口径与运行时同款(`reflect-exec` 的 `bootstrap_m5`):
//! **TOML `[[subagents]]` > workspace `.zhuye/subagents/*.md` >
//! home `~/.zhuye/subagents/*.md` > 硬编码 explorer**。
//!
//! 文件格式:顶部 `---` 界定的 YAML frontmatter + body(正文作
//! `system_prompt` 兜底)—— 由核心的 `parse_subagent_str` 解析。

use std::path::Path;

use reflect_config::SubagentSpecConfig;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::error::{CommandError, CommandResult};
use crate::state::MinimalAgent;

/// spec 的来源作用域。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SubagentSpecSource {
    /// config.toml 的 `[[subagents]]`。
    Config,
    /// `<workspace>/.zhuye/subagents/*.md`。
    Workspace,
    /// `~/.zhuye/subagents/*.md`。
    User,
    /// 运行时硬编码的 explorer(全部源为空时的兜底)。
    Builtin,
}

/// 一个子代理 spec(camelCase 出线)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentSpecInfo {
    /// 角色名(对应 `call_<role>` 工具)。
    pub role: String,
    /// 展示名。
    pub name: String,
    /// 独立模型(缺省 = 继承父 agent)。
    pub model: Option<String>,
    /// system prompt。
    pub system_prompt: String,
    /// 允许的工具白名单。
    pub allowed_tools: Vec<String>,
    /// 允许的 skill。
    pub allowed_skills: Vec<String>,
    /// 单次调用轮数上限。
    pub max_turns: Option<u32>,
    /// 来源。
    pub source: SubagentSpecSource,
    /// 定义文件路径(md 来源才有)。
    pub path: Option<String>,
}

/// 列出当前生效的全部子代理 spec(按合并口径,高优先级覆盖低)。
#[tauri::command]
pub async fn reflect_list_subagent_specs(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<Vec<SubagentSpecInfo>> {
    let cfg = agent.inner.cfg.read().clone();
    let mut merged: std::collections::BTreeMap<String, SubagentSpecInfo> =
        std::collections::BTreeMap::new();

    // 优先级从低到高:home md → workspace md → TOML。
    for (dir, source) in [
        (
            reflect_app_core::paths::user_data_path_or_relative(&["subagents"]),
            SubagentSpecSource::User,
        ),
        (
            reflect_app_core::paths::project_data_path(&agent.workspace(), &["subagents"]),
            SubagentSpecSource::Workspace,
        ),
    ] {
        for (role, spec) in load_dir(&dir, source) {
            merged.insert(role, spec);
        }
    }
    for spec in &cfg.subagents {
        merged.insert(
            spec.role.clone(),
            SubagentSpecInfo {
                role: spec.role.clone(),
                name: spec.name.clone(),
                model: spec.model.clone(),
                system_prompt: spec.system_prompt.clone(),
                allowed_tools: spec.allowed_tools.clone(),
                allowed_skills: spec.allowed_skills.clone(),
                max_turns: spec.max_turns,
                source: SubagentSpecSource::Config,
                path: None,
            },
        );
    }

    // 全部源为空 → 运行时硬编码 explorer 兜底(GUI 也照实显示)。
    if merged.is_empty() {
        merged.insert(
            "explorer".to_string(),
            SubagentSpecInfo {
                role: "explorer".into(),
                name: "Explorer".into(),
                model: None,
                system_prompt: "You are an explorer subagent. Inspect the codebase and return a concise summary.".into(),
                allowed_tools: vec!["bash".into(), "read".into(), "grep".into(), "glob".into()],
                allowed_skills: vec![],
                max_turns: None,
                source: SubagentSpecSource::Builtin,
                path: None,
            },
        );
    }
    Ok(merged.into_values().collect())
}

/// 保存一个子代理 spec(写到工作区 `.zhuye/subagents/<role>.md`)。
///
/// `markdown` 是完整文件内容(frontmatter + body)—— 格式与核心的
/// `parse_subagent_str` 一致。写前**先解析校验**:非法 frontmatter 直接
/// 报错,不落盘(避免写坏文件让 agent 起不来)。
#[tauri::command]
pub async fn reflect_save_subagent_spec(
    agent: State<'_, MinimalAgent>,
    role: String,
    markdown: String,
) -> CommandResult<()> {
    validate_role(&role)?;
    // 校验:能解析才算合法 spec。
    let parsed = reflect_subagent::parse_subagent_str(&markdown).map_err(|e| CommandError {
        msg: format!("invalid subagent spec: {e}"),
    })?;
    let dir = reflect_app_core::paths::project_data_path(&agent.workspace(), &["subagents"]);
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{role}.md"));
    crate::persistence::write_atomic(&path, markdown.as_bytes())?;
    tracing::info!(role = %parsed.role, path = %path.display(), "subagent spec saved");
    Ok(())
}

/// 删除一个子代理 spec(只删工作区 md;用户级 / TOML 来源不动)。
#[tauri::command]
pub async fn reflect_delete_subagent_spec(
    agent: State<'_, MinimalAgent>,
    role: String,
) -> CommandResult<()> {
    validate_role(&role)?;
    let path = reflect_app_core::paths::project_data_path(&agent.workspace(), &["subagents"])
        .join(format!("{role}.md"));
    if path.exists() {
        std::fs::remove_file(&path)?;
    }
    Ok(())
}

/// 读取一个子代理 spec 的原始 md 文本(供编辑器回填)。
#[tauri::command]
pub async fn reflect_get_subagent_spec(
    agent: State<'_, MinimalAgent>,
    role: String,
) -> CommandResult<Option<String>> {
    validate_role(&role)?;
    let path = reflect_app_core::paths::project_data_path(&agent.workspace(), &["subagents"])
        .join(format!("{role}.md"));
    Ok(std::fs::read_to_string(path).ok())
}

/// 目录内的所有 spec(按 role 索引)。
fn load_dir(dir: &Path, source: SubagentSpecSource) -> Vec<(String, SubagentSpecInfo)> {
    let Ok(specs) = reflect_subagent::load_subagents_dir(dir) else {
        return Vec::new();
    };
    specs
        .into_iter()
        .map(|s: SubagentSpecConfig| {
            let path = dir.join(format!("{}.md", s.role));
            (
                s.role.clone(),
                SubagentSpecInfo {
                    role: s.role.clone(),
                    name: s.name,
                    model: s.model,
                    system_prompt: s.system_prompt,
                    allowed_tools: s.allowed_tools,
                    allowed_skills: s.allowed_skills,
                    max_turns: s.max_turns,
                    source,
                    path: Some(path.display().to_string()),
                },
            )
        })
        .collect()
}

/// 角色名校验(会进文件路径)。
fn validate_role(role: &str) -> CommandResult<()> {
    let r = role.trim();
    if r.is_empty() {
        return Err(CommandError {
            msg: "subagent role cannot be empty".into(),
        });
    }
    if r.contains('/') || r.contains('\\') || r.contains('\0') || r == ".." {
        return Err(CommandError {
            msg: format!("subagent role contains invalid characters: {role:?}"),
        });
    }
    Ok(())
}
