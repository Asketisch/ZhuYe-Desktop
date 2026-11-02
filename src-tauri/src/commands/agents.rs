//! Agent 定义管理命令 —— 包装 `reflect_agent_def` crate。
//!
//! agent profile 管理 UI 的后端。每个 agent 是位于 `~/.zhuye/agents/<name>.md`
//! 的 Markdown 文件(带 YAML frontmatter),与 TUI/CLI 共享。
//!
//! ## 命令清单
//!
//! - `reflect_list_agent_defs` — 列出所有定义(按 name 排序)
//! - `reflect_get_agent_def(name)` — 单条定义
//! - `reflect_save_agent_def(def)` — 创建 / 更新(序列化为 `.md`)
//! - `reflect_delete_agent_def(name)` — 删除文件
//! - `reflect_parse_agent_md(text)` — 预览 / 校验 markdown 字符串
//!
//! ## 序列化
//!
//! `reflect-agent-def` 只提供 parser(`parse_agent_str`),没有内置
//! to-markdown 序列化。`reflect_save_agent_def` 在命令层手动构造
//! frontmatter(YAML,跳过 `system_prompt`)+ body,保证 round-trip 通过
//! `parse_agent_str`。
//!
//! v1.6:frontmatter **不写** `source` 字段 —— 上游 parser 对文件来源
//! 强制 `SystemPromptSource::Custom`(用户 md 原文不动),写了也会被覆盖;
//! `BuiltinDefault`(按模型从提示词库解析 `system.main`)只属于引擎自带的
//! 默认 agent,桌面端不构造它。

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use reflect_agent_def::{AgentDefinition, load_agents_dir, parse_agent_str};
use reflect_memory::MemoryScope;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::error::{CommandError, CommandResult};
use crate::state::MinimalAgent;

/// `~/.zhuye/agents/` 目录(存 agent 定义 markdown 文件)。
fn agents_dir() -> CommandResult<PathBuf> {
    reflect_config::paths::data_path(&["agents"]).ok_or_else(|| CommandError {
        msg: "no home dir".into(),
    })
}

/// 把 `AgentDefinition` 序列化为 markdown（frontmatter + 正文）。
///
/// 手动实现而非 `serde_yaml::to_string` 整个结构,因为 `system_prompt` 字段
/// 必须作为 body(在 frontmatter 之后),不能出现在 YAML 块里。
fn serialize_agent_md(def: &AgentDefinition) -> CommandResult<String> {
    // 构造 frontmatter 的 YAML 视图(排除 system_prompt)。
    #[derive(Serialize)]
    struct Frontmatter {
        name: String,
        description: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        spawnable: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        readonly: Option<bool>,
        #[serde(skip_serializing_if = "Vec::is_empty", default)]
        tools: Vec<String>,
        #[serde(skip_serializing_if = "Vec::is_empty", default)]
        disallowed_tools: Vec<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        model: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        max_turns: Option<u32>,
        #[serde(skip_serializing_if = "Vec::is_empty", default)]
        memory: Vec<String>,
        #[serde(skip_serializing_if = "Vec::is_empty", default)]
        mcp_collections: Vec<String>,
    }

    let memory_str: Vec<String> = def
        .memory
        .iter()
        .map(|s| s.to_string().to_lowercase())
        .collect();

    let fm = Frontmatter {
        name: def.name.clone(),
        description: def.description.clone(),
        spawnable: if def.spawnable { Some(true) } else { None },
        readonly: if def.readonly { Some(true) } else { None },
        tools: def.tools.clone(),
        disallowed_tools: def.disallowed_tools.clone(),
        model: def.model.clone(),
        max_turns: def.max_turns,
        memory: memory_str,
        mcp_collections: def.mcp_collections.clone(),
    };

    let yaml = serde_yaml::to_string(&fm).map_err(|e| CommandError {
        msg: format!("agent def yaml serialize: {e}"),
    })?;

    Ok(format!("---\n{yaml}---\n{}\n", def.system_prompt))
}

/// 计算目标文件路径:`<agents_dir>/<name>.md`。校验 name 防 path traversal。
fn path_for(name: &str, dir: &Path) -> CommandResult<PathBuf> {
    if name.is_empty() {
        return Err(CommandError {
            msg: "agent name cannot be empty".into(),
        });
    }
    // 防 `../` / 绝对路径 / 路径分隔符 / NUL。只拦截真的路径穿越,
    // 允许 `foo..bar` 这样的中段连续 dot(不会在 join 后逃出 dir)。
    if name.contains('/')
        || name.contains('\\')
        || name == ".."
        || name.starts_with("../")
        || name.starts_with("..\\")
        || name.contains('\0')
    {
        return Err(CommandError {
            msg: format!("agent name contains invalid characters: {name:?}"),
        });
    }
    Ok(dir.join(format!("{name}.md")))
}

/// 列出所有 agent 定义(按 name 排序)。
#[tauri::command]
pub async fn reflect_list_agent_defs(
    _agent: State<'_, MinimalAgent>,
) -> CommandResult<Vec<AgentDefinition>> {
    let dir = agents_dir()?;
    let map: HashMap<String, AgentDefinition> =
        load_agents_dir(&dir).map_err(CommandError::from)?;
    let mut v: Vec<AgentDefinition> = map.into_values().collect();
    v.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(v)
}

/// 按 name 读取单条 agent 定义。未找到时抛错。
#[tauri::command]
pub async fn reflect_get_agent_def(
    _agent: State<'_, MinimalAgent>,
    name: String,
) -> CommandResult<AgentDefinition> {
    let dir = agents_dir()?;
    let path = path_for(&name, &dir)?;
    let raw = std::fs::read_to_string(&path).map_err(|e| CommandError {
        msg: format!("agent def '{name}' not found: {e}"),
    })?;
    parse_agent_str(&raw).map_err(CommandError::from)
}

/// 创建或更新一条 agent 定义。序列化为 `<agents_dir>/<name>.md`。
#[tauri::command]
pub async fn reflect_save_agent_def(
    _agent: State<'_, MinimalAgent>,
    def: AgentDefinition,
    create_only: Option<bool>,
) -> CommandResult<AgentDefinition> {
    if def.name.is_empty() {
        return Err(CommandError {
            msg: "agent def name is required".into(),
        });
    }
    if def.description.is_empty() {
        return Err(CommandError {
            msg: "agent def description is required".into(),
        });
    }
    let dir = agents_dir()?;
    std::fs::create_dir_all(&dir).map_err(CommandError::from)?;
    let path = path_for(&def.name, &dir)?;
    let md = serialize_agent_md(&def)?;
    // 写盘前校验，避免无效内容覆盖已有定义。
    let back = parse_agent_str(&md).map_err(CommandError::from)?;
    if create_only.unwrap_or(false) {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(CommandError::from)?;
        if let Err(error) = file.write_all(md.as_bytes()) {
            drop(file);
            let _ = std::fs::remove_file(&path);
            return Err(error.into());
        }
    } else {
        crate::persistence::write_atomic(&path, md.as_bytes()).map_err(CommandError::from)?;
    }
    Ok(back)
}

/// 删除一条 agent 定义文件。删除成功返回 `true`,不存在返回 `false`。
#[tauri::command]
pub async fn reflect_delete_agent_def(
    _agent: State<'_, MinimalAgent>,
    name: String,
) -> CommandResult<bool> {
    let dir = agents_dir()?;
    let path = path_for(&name, &dir)?;
    if !path.exists() {
        return Ok(false);
    }
    std::fs::remove_file(&path).map_err(CommandError::from)?;
    Ok(true)
}

/// 把 markdown 字符串解析 / 校验为 agent 定义(无副作用)。
/// 编辑器在保存前做实时预览 / 校验时使用。
#[tauri::command]
pub async fn reflect_parse_agent_md(
    _agent: State<'_, MinimalAgent>,
    text: String,
) -> CommandResult<AgentDefinition> {
    parse_agent_str(&text).map_err(CommandError::from)
}

/// 顶层 config/patch 类型(供前端做 partial update;当前未直接用,留作扩展)。
#[allow(dead_code)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentDefPatch {
    pub name: Option<String>,
    pub description: Option<String>,
    pub system_prompt: Option<String>,
    pub model: Option<Option<String>>,
    pub tools: Option<Vec<String>>,
    pub disallowed_tools: Option<Vec<String>>,
    pub spawnable: Option<bool>,
    pub readonly: Option<bool>,
    pub max_turns: Option<Option<u32>>,
}

// ====== 活跃 agent ======

/// 某 scope 的记忆文件路径。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryScopePath {
    /// scope 名(`project` / `user`)。
    pub scope: String,
    /// `MEMORY.md` 的绝对路径。
    pub path: String,
}

/// 当前活跃 agent 的状态(camelCase 出线)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveAgentInfo {
    /// 活跃 agent 名(决定加载哪条 agent 定义 + 记忆目录)。
    pub name: String,
    /// 是否命中真实的 agent 定义文件(false = 用内置默认定义)。
    pub def_found: bool,
    /// 该定义声明的 memory 作用域。
    ///
    /// **空数组 = 不加载任何记忆** —— 此时 GUI 的 Memory 视图里写的内容
    /// 不会被注入 system prompt。核心的设计是「记忆按 agent 显式启用」
    /// (与 hooks 同款显式开关原则),所以这个字段必须让用户看见。
    pub memory_scopes: Vec<String>,
    /// 注入预算(核心常量 `MAX_MEMORY_INJECT_CHARS`)。
    pub inject_budget_chars: usize,
    /// 各 scope 的记忆文件路径(即便该 scope 未被声明也列出,便于定位)。
    pub memory_paths: Vec<MemoryScopePath>,
}

/// 解析活跃 agent 的定义(与核心 `m4_bootstrap` 同口径:工作区优先,
/// 再用户级;都没有则用内置默认定义)。
fn resolve_active_def(name: &str, workspace: &Path) -> (bool, Vec<String>) {
    let mut agents = reflect_agent_def::load_agents_dir(&reflect_config::paths::project_data_path(
        workspace,
        &["agents"],
    ))
    .unwrap_or_default();
    agents.extend(
        reflect_agent_def::load_agents_dir(&reflect_config::paths::data_path_or_relative(&[
            "agents",
        ]))
        .unwrap_or_default(),
    );
    match agents.remove(name) {
        Some(def) => (true, def.memory.iter().map(|s| s.to_string()).collect()),
        None => (false, Vec::new()),
    }
}

/// 组装活跃 agent 状态快照。
fn active_agent_info(agent: &MinimalAgent) -> ActiveAgentInfo {
    let name = crate::agent_state::AgentState::active_agent();
    let (def_found, memory_scopes) = resolve_active_def(&name, &agent.workspace());
    let home = dirs::home_dir().unwrap_or_default();
    let memory_paths = [MemoryScope::Project, MemoryScope::User]
        .iter()
        .filter_map(|scope| {
            reflect_memory::resolve_path(*scope, &agent.workspace(), &home, &name)
                .ok()
                .map(|p| MemoryScopePath {
                    scope: scope.to_string(),
                    path: p.display().to_string(),
                })
        })
        .collect();
    ActiveAgentInfo {
        name,
        def_found,
        memory_scopes,
        inject_budget_chars: reflect_memory::MAX_MEMORY_INJECT_CHARS,
        memory_paths,
    }
}

/// 查询当前活跃 agent(及其记忆作用域 / 注入预算)。
///
/// 回答「GUI 里编辑的 agent 定义与记忆,agent 到底用不用」——
/// 此前桌面端硬编码 agent 名,GUI 的 Agents 视图是死胡同。
#[tauri::command]
pub async fn reflect_get_active_agent(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<ActiveAgentInfo> {
    Ok(active_agent_info(&agent))
}

/// 设置当前活跃 agent 并**立即重绑**当前会话(新定义立刻生效)。
///
/// 重绑语义与 provider 热重载一致:replay 当前会话历史 → 强制重建线程 →
/// 保留会话级权限模式。重绑失败时尝试恢复旧 agent，恢复失败会一并报告。
#[tauri::command]
pub async fn reflect_set_active_agent(
    agent: State<'_, MinimalAgent>,
    name: String,
) -> CommandResult<ActiveAgentInfo> {
    let _config_write = agent.inner.config_write_lock.lock().await;
    let _transition = agent.inner.session_transition_lock.lock().await;
    // 先取得历史；回放失败时不能以空上下文重建或更新活跃 agent。
    let bound = if let Some(sid) = agent.bound_session_id() {
        let current_mode = agent
            .inner
            .thread
            .lock()
            .as_ref()
            .map(|t| t.config().permission_mode());
        let preload = crate::commands::sessions::replay_for_preload(&sid)
            .await
            .map_err(|e| CommandError {
                msg: format!("replay for active agent failed: {e:#}"),
            })?;
        Some((sid, current_mode, preload))
    } else {
        None
    };
    let previous = crate::agent_state::AgentState::active_agent();
    crate::agent_state::AgentState::set_active_agent(&name).map_err(|e| CommandError {
        msg: format!("set active agent failed: {e:#}"),
    })?;
    if let Some((sid, current_mode, preload)) = bound {
        if let Err(error) =
            crate::state::rebind::rebind_session_forced(&agent, sid, preload, current_mode)
        {
            let rollback = crate::agent_state::AgentState::set_active_agent(&previous);
            return Err(CommandError {
                msg: match rollback {
                    Ok(()) => format!("rebind for active agent failed: {error:#}"),
                    Err(rollback_error) => format!(
                        "rebind for active agent failed: {error:#}; restoring previous agent failed: {rollback_error:#}"
                    ),
                },
            });
        }
    }
    Ok(active_agent_info(&agent))
}

#[cfg(test)]
mod tests {
    //! 命令包装层测试。沿用 sessions.rs / tasks.rs / schedule.rs 策略:
    //! 不 spin Tauri runtime,直接测核心逻辑(序列化 / 路径校验 / round-trip)。

    use super::*;
    use reflect_agent_def::{AgentDefinition, SystemPromptSource};

    #[test]
    fn serialize_round_trips_through_parser() {
        let def = AgentDefinition {
            name: "code-reviewer".into(),
            description: "Reviews code changes".into(),
            spawnable: true,
            readonly: true,
            tools: vec!["read".into(), "grep".into()],
            disallowed_tools: vec!["bash".into()],
            model: Some("inherit".into()),
            max_turns: Some(30),
            memory: vec![],
            mcp_collections: vec![],
            system_prompt: "# Code Reviewer\n\nYou are strict.".into(),
            // v1.6:文件型定义恒为 Custom(上游 parser 强制)。
            source: SystemPromptSource::Custom,
        };
        let md = serialize_agent_md(&def).unwrap();
        // 必须有 frontmatter 标记 + body。
        assert!(md.starts_with("---\n"));
        assert!(md.contains("name: code-reviewer"));
        assert!(md.contains("spawnable: true"));
        assert!(md.contains("# Code Reviewer"));

        let back = parse_agent_str(&md).unwrap();
        assert_eq!(back.name, "code-reviewer");
        assert!(back.spawnable);
        assert!(back.readonly);
        assert_eq!(back.tools, vec!["read", "grep"]);
        assert_eq!(back.model.as_deref(), Some("inherit"));
        assert!(back.system_prompt.contains("You are strict."));
    }

    #[test]
    fn file_backed_def_is_always_custom_source() {
        // v1.6:上游 parser 对文件来源强制 `source = Custom` —— 即使用户
        // 自己写了 `source: builtin_default`,也会被覆盖。因此命令层的
        // frontmatter 序列化**不写** `source`:写进去会被忽略,反而误导
        // 手改文件的人。
        //
        // `BuiltinDefault` 只属于引擎自带的默认 agent(按模型从提示词库
        // 解析 `system.main`),桌面端不构造它。
        let def = AgentDefinition {
            name: "builtin".into(),
            description: "per-model prompt".into(),
            system_prompt: String::new(),
            source: SystemPromptSource::BuiltinDefault,
            ..Default::default()
        };
        let md = serialize_agent_md(&def).unwrap();
        assert!(!md.contains("source"), "frontmatter 不应写 source: {md}");

        let back = parse_agent_str(&md).unwrap();
        assert_eq!(back.source, SystemPromptSource::Custom);
        assert!(back.system_prompt.is_empty());
    }

    #[test]
    fn serialize_minimal_omits_optional_fields() {
        let def = AgentDefinition {
            name: "minimal".into(),
            description: "just enough".into(),
            ..Default::default()
        };
        let md = serialize_agent_md(&def).unwrap();
        assert!(!md.contains("spawnable"));
        assert!(!md.contains("tools:"));
        assert!(!md.contains("model:"));
    }

    #[test]
    fn path_for_rejects_traversal() {
        let dir = Path::new("/tmp");
        assert!(path_for("../etc/passwd", dir).is_err());
        assert!(path_for("a/b", dir).is_err());
        assert!(path_for("a\\b", dir).is_err());
        assert!(path_for("", dir).is_err());
        assert!(path_for("good-name", dir).is_ok());
    }

    #[test]
    fn path_for_allows_inner_dots() {
        let dir = Path::new("/tmp");
        // `..` 仅出现在 name 中段时不会逃出目录;join 后的路径仍在 `dir` 内。
        assert!(path_for("foo..bar", dir).is_ok());
        assert!(path_for("..foo", dir).is_ok());
        assert!(path_for("foo..", dir).is_ok());
    }

    #[test]
    fn path_for_builds_correct_filename() {
        let dir = Path::new("/tmp/agents");
        let p = path_for("reviewer", dir).unwrap();
        assert_eq!(p, PathBuf::from("/tmp/agents/reviewer.md"));
    }
}
