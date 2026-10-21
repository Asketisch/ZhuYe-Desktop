//! 活跃 agent 状态 —— 桌面端选择当前生效的 agent 定义。
//!
//! ## 为什么需要
//!
//! 核心的 `build_default_m4(workspace, agent_name, …)` 按**名字**在
//! workspace + home 的 agents 目录里找定义;CLI 用 `--agent` 传(缺省
//! `"default"`)。桌面端此前硬编码 `"desktop"`,后果有两个:
//!
//! 1. **GUI 的 Agents 视图是死胡同** —— 用户能创建/编辑
//!    `~/.reflect/agents/*.md`,但运行时永远找它们(只认 "desktop")。
//! 2. **记忆路径对不上** —— 记忆文件路径由 agent 名派生
//!    (`.reflect/agent-memory/<agent>/MEMORY.md`),GUI 写一个目录、
//!    运行时读另一个目录。
//!
//! 现在活跃 agent 名由桌面端偏好文件(`~/.reflect/desktop.json`)决定,
//! 缺省 `"default"`(与 CLI 一致 —— 两个前端共用同一个 agent 定义与
//! 记忆),线程构造与记忆路径共用同一个来源。
//!
//! ## 与核心 config 的关系
//!
//! 核心的 `ReflectConfig` 没有 `[active].agent` 字段(CLI 用的是命令行
//! 旗标),且桌面端的 config 读写会把解析后的结构重新序列化 —— 手写到
//! `config.toml` 里的自定义键会被抹掉。因此活跃 agent 放在**桌面端自己的
//! 偏好文件**里,不动核心 config schema,也不与 config 往返冲突。

use std::path::PathBuf;

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
}

/// 桌面端偏好文件路径(`~/.reflect/desktop.json`)。
fn prefs_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".reflect/desktop.json"))
}

pub(crate) struct AgentState;

impl AgentState {
    /// 当前活跃 agent 名。
    ///
    /// 进程内优先;未设置过则读偏好文件;都没有则缺省 `"default"`。
    pub(crate) fn active_agent() -> String {
        let cached = ACTIVE_AGENT.read().clone();
        if cached != DEFAULT_ACTIVE_AGENT {
            return cached;
        }
        // 缓存还是缺省值 → 读一次磁盘(可能是上次运行持久化的)。
        if let Some(name) = Self::read_prefs().active_agent.filter(|n| !n.is_empty()) {
            *ACTIVE_AGENT.write() = name.clone();
            return name;
        }
        DEFAULT_ACTIVE_AGENT.to_string()
    }

    /// 设置活跃 agent 名并持久化。
    pub(crate) fn set_active_agent(name: &str) -> anyhow::Result<()> {
        let name = name.trim();
        if name.is_empty() {
            anyhow::bail!("agent name cannot be empty");
        }
        // 名字会进文件路径(`.reflect/agent-memory/<name>/`),拦掉穿越。
        if name.contains('/')
            || name.contains('\\')
            || name.contains('\0')
            || name == ".."
            || name.starts_with("../")
        {
            anyhow::bail!("agent name contains invalid characters: {name:?}");
        }
        *ACTIVE_AGENT.write() = name.to_string();
        let path = prefs_path().ok_or_else(|| anyhow::anyhow!("no HOME dir for desktop prefs"))?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut prefs = Self::read_prefs();
        prefs.active_agent = Some(name.to_string());
        let json = serde_json::to_string_pretty(&prefs)?;
        std::fs::write(path, json)?;
        Ok(())
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
    fn set_rejects_path_traversal() {
        // 名字会进文件路径,必须拦穿越。
        assert!(AgentState::set_active_agent("../etc").is_err());
        assert!(AgentState::set_active_agent("a/b").is_err());
        assert!(AgentState::set_active_agent("a\\b").is_err());
        assert!(AgentState::set_active_agent("").is_err());
    }
}
