//! 活跃 agent 状态 —— 桌面端选择当前生效的 agent 定义。
//!
//! ## 为什么需要
//!
//! 核心的 `build_default_m4(workspace, agent_name, …)` 按**名字**在
//! workspace + home 的 agents 目录里找定义;CLI 用 `--agent` 传(缺省
//! `"default"`)。桌面端此前硬编码 `"desktop"`,后果有两个:
//!
//! 1. **GUI 的 Agents 视图是死胡同** —— 用户能创建/编辑
//!    `~/.zhuye/agents/*.md`,但运行时永远找它们(只认 "desktop")。
//! 2. **记忆路径对不上** —— 记忆文件路径由 agent 名派生
//!    (`.zhuye/agent-memory/<agent>/MEMORY.md`),GUI 写一个目录、
//!    运行时读另一个目录。
//!
//! 现在活跃 agent 名由桌面端偏好文件(`~/.zhuye/desktop.json`)决定,
//! 缺省 `"default"`(与 CLI 一致 —— 两个前端共用同一个 agent 定义与
//! 记忆),线程构造与记忆路径共用同一个来源。
//!
//! ## 与核心 config 的关系
//!
//! 核心的 `ReflectConfig` 没有 `[active].agent` 字段(CLI 用的是命令行
//! 旗标),且桌面端的 config 读写会把解析后的结构重新序列化 —— 手写到
//! `config.toml` 里的自定义键会被抹掉。因此活跃 agent 放在**桌面端自己的
//! 偏好文件**里,不动核心 config schema,也不与 config 往返冲突。

use std::path::{Path, PathBuf};

use once_cell::sync::Lazy;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};

/// 缺省活跃 agent 名(与 CLI 的 `--agent` 缺省一致)。
pub(crate) const DEFAULT_ACTIVE_AGENT: &str = "default";

/// 进程内缓存的活跃 agent 名。
static ACTIVE_AGENT: Lazy<RwLock<String>> =
    Lazy::new(|| RwLock::new(DEFAULT_ACTIVE_AGENT.to_string()));

/// 桌面端偏好文件内容。
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct DesktopPrefs {
    /// 活跃 agent 定义名(缺省 `"default"`)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    active_agent: Option<String>,
    #[serde(flatten)]
    other: std::collections::BTreeMap<String, serde_json::Value>,
}

/// 桌面端偏好文件路径(`~/.zhuye/desktop.json`)。
fn prefs_path() -> Option<PathBuf> {
    reflect_config::paths::data_path(&["desktop.json"])
}

pub(crate) struct AgentState;

impl AgentState {
    /// 当前活跃 agent 名。
    ///
    /// 进程内优先;未设置过则读偏好文件;都没有则缺省 `"default"`。
    pub(crate) fn active_agent() -> String {
        let mut active = ACTIVE_AGENT.write();
        if *active != DEFAULT_ACTIVE_AGENT {
            return active.clone();
        }
        // 缺省值时读取持久化偏好；持锁避免与并发写入交错。
        if let Some(name) = Self::read_prefs().active_agent.filter(|n| !n.is_empty()) {
            *active = name;
        }
        active.clone()
    }

    /// 设置活跃 agent 名并持久化。
    pub(crate) fn set_active_agent(name: &str) -> anyhow::Result<()> {
        let name = name.trim();
        if name.is_empty() {
            anyhow::bail!("agent name cannot be empty");
        }
        // 名字会进文件路径(`.zhuye/agent-memory/<name>/`),拦掉穿越。
        if name.contains('/')
            || name.contains('\\')
            || name.contains('\0')
            || name == ".."
            || name.starts_with("../")
        {
            anyhow::bail!("agent name contains invalid characters: {name:?}");
        }
        let mut active = ACTIVE_AGENT.write();
        let path = prefs_path().ok_or_else(|| anyhow::anyhow!("no HOME dir for desktop prefs"))?;
        persist_active_agent(&path, name, &mut active)
    }

    /// 读偏好文件(损坏 → 空,不阻断启动)。
    fn read_prefs() -> DesktopPrefs {
        let Some(path) = prefs_path() else {
            return DesktopPrefs::default();
        };
        let Ok(raw) = std::fs::read_to_string(path) else {
            return DesktopPrefs::default();
        };
        serde_json::from_str(&raw).unwrap_or_default()
    }
}

fn persist_active_agent(path: &Path, name: &str, active: &mut String) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut prefs = match std::fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str::<DesktopPrefs>(&raw).map_err(|error| {
            anyhow::anyhow!("invalid desktop preferences {}: {error}", path.display())
        })?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => DesktopPrefs::default(),
        Err(error) => return Err(error.into()),
    };
    prefs.active_agent = Some(name.to_string());
    crate::persistence::write_atomic(path, serde_json::to_string_pretty(&prefs)?.as_bytes())?;
    *active = name.to_string();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_active_agent_matches_cli() {
        // 缺省必须是 "default" —— 与 CLI 的 `--agent` 缺省一致,两个
        // 前端才能共用同一个 agent 定义与记忆目录。
        assert_eq!(DEFAULT_ACTIVE_AGENT, "default");
    }

    #[test]
    fn write_failure_does_not_change_active_name() {
        let dir = tempfile::tempdir().unwrap();
        let mut active = "previous".to_string();
        assert!(persist_active_agent(dir.path(), "next", &mut active).is_err());
        assert_eq!(active, "previous");
    }

    #[test]
    fn invalid_preferences_are_preserved_and_unknown_fields_survive_updates() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("desktop.json");
        let mut active = "previous".to_string();
        std::fs::write(&path, "broken").unwrap();
        assert!(persist_active_agent(&path, "next", &mut active).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "broken");
        assert_eq!(active, "previous");

        std::fs::write(
            &path,
            r#"{"active_agent":"previous","other_setting":{"enabled":true}}"#,
        )
        .unwrap();
        persist_active_agent(&path, "next", &mut active).unwrap();
        let saved: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(saved["active_agent"], "next");
        assert_eq!(saved["other_setting"]["enabled"], true);
        assert_eq!(active, "next");
    }

    #[test]
    fn set_rejects_path_traversal() {
        // 名字会进文件路径,必须拦穿越。
        assert!(AgentState::set_active_agent("../etc").is_err());
        assert!(AgentState::set_active_agent("a/b").is_err());
        assert!(AgentState::set_active_agent("a\\b").is_err());
        assert!(AgentState::set_active_agent("").is_err());
    }
}
