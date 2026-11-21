//! 工作区状态管理 —— 维护全局工作区路径覆盖。
//!
//! 通过 `once_cell::Lazy` 单例 + `RwLock` 提供跨线程安全的
//! workspace override 读写。优先级高于启动时捕获的 cwd。
//!
//! v1.11 桌面#5:多目录综合工作区 —— `ADDITIONAL_DIRS` 承载主工作区
//! **之外**的附加目录(合成一个项目视图)。引擎侧语义:附加目录拼进
//! `AgentConfig.sandbox_writable`(`[sandbox].writable_dirs` 同源),
//! 文件类工具的沙箱边界与相对解析对其放行;主工作区仍是规范根
//! (memory / skills / rollout 相对它),协议层不动(v0 冻结)。

use std::path::{Path, PathBuf};

use once_cell::sync::Lazy;
use parking_lot::RwLock;

static WORKSPACE_OVERRIDE: Lazy<RwLock<Option<PathBuf>>> = Lazy::new(|| RwLock::new(None));

/// v1.11 桌面#5:主工作区之外的附加目录(跨线程共享,bind 时拼进
/// sandbox_writable)。
static ADDITIONAL_DIRS: Lazy<RwLock<Vec<PathBuf>>> = Lazy::new(|| RwLock::new(Vec::new()));

/// `workspaces.json` 一条记录里恢复所需的字段(与 commands::workspaces
/// 的 `WorkspaceInfo` 同构,这里只取必要子集避免模块间类型纠缠)。
#[derive(serde::Deserialize)]
struct WorkspaceCandidate {
    path: String,
    #[serde(default)]
    last_used: u64,
    #[serde(default)]
    hidden: bool,
}

/// 从 workspaces.json 原文挑选「最近使用的非隐藏、仍存在的目录」。
/// 纯函数 —— 可测,不触 IO 与全局态。
fn pick_last_used(raw: &str) -> Option<PathBuf> {
    let list: Vec<WorkspaceCandidate> = serde_json::from_str(raw).ok()?;
    list.into_iter()
        .filter(|c| !c.hidden)
        .filter(|c| PathBuf::from(&c.path).is_dir())
        .max_by_key(|c| c.last_used)
        .map(|c| PathBuf::from(c.path))
}

pub(crate) fn same_path(a: &Path, b: &Path) -> bool {
    a == b || matches!((a.canonicalize(), b.canonicalize()), (Ok(a), Ok(b)) if a == b)
}

pub(crate) struct WorkspaceState;

impl WorkspaceState {
    pub(crate) fn set(path: PathBuf) {
        *WORKSPACE_OVERRIDE.write() = Some(path);
    }

    /// 启动恢复:取 `workspaces.json` 里最近使用的**非隐藏**工作区作为
    /// 本次启动的默认工作区。
    ///
    /// 背景:Finder / Dock 启动的桌面 app 进程 cwd 是 `/`,而 MinimalAgent
    /// 的 workspace fallback 是进程 cwd —— 首页新会话会归属无意义的根
    /// 目录,再叠加「用户此前移除(隐藏)了 `/` 项目」就表现为新会话在
    /// 侧栏彻底消失(分组函数按 hidden 过滤,有意的语义)。恢复「上次
    /// 项目」才符合桌面使用预期。无历史 / 全部隐藏 / 路径已不存在时
    /// 退回 `$HOME`(仍优于 `/`);解析失败静默 —— 这是体验优化,不阻塞
    /// 启动,也不该在启动路径上抛错。
    pub(crate) fn restore_last_used() {
        let Some(file) = zhuye_config::paths::data_path(&["workspaces.json"]) else {
            return;
        };
        let raw = match std::fs::read_to_string(&file) {
            Ok(raw) => raw,
            Err(_) => return, // 无历史(首次启动) → 保持 fallback
        };
        match pick_last_used(&raw) {
            Some(path) => WorkspaceState::set(path),
            // 全部隐藏 / 解析失败 → 退回 $HOME,避免 `/` 再次成为归属。
            None => {
                if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
                    WorkspaceState::set(home);
                }
            }
        }
    }

    pub(crate) fn get() -> Option<PathBuf> {
        WORKSPACE_OVERRIDE.read().clone()
    }

    /// v1.11 桌面#5:替换附加目录集(全量覆盖;切换主工作区时清空)。
    pub(crate) fn set_additional_dirs(dirs: Vec<PathBuf>) {
        *ADDITIONAL_DIRS.write() = dirs;
    }

    /// v1.11 桌面#5:读当前附加目录快照(thread_factory bind 时拼
    /// sandbox_writable)。
    pub(crate) fn additional_dirs() -> Vec<PathBuf> {
        ADDITIONAL_DIRS.read().clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_and_get_share_the_same_override() {
        let path = PathBuf::from("/tmp/zhuye-workspace-state-test");
        WorkspaceState::set(path.clone());
        assert_eq!(WorkspaceState::get(), Some(path));
    }

    #[test]
    fn additional_dirs_roundtrip_and_reset() {
        WorkspaceState::set_additional_dirs(vec![
            PathBuf::from("/tmp/extra-a"),
            PathBuf::from("/tmp/extra-b"),
        ]);
        assert_eq!(
            WorkspaceState::additional_dirs(),
            vec![PathBuf::from("/tmp/extra-a"), PathBuf::from("/tmp/extra-b")]
        );
        // 全量覆盖。
        WorkspaceState::set_additional_dirs(vec![PathBuf::from("/tmp/extra-c")]);
        assert_eq!(
            WorkspaceState::additional_dirs(),
            vec![PathBuf::from("/tmp/extra-c")]
        );
        // 清空(切换主工作区时)。
        WorkspaceState::set_additional_dirs(Vec::new());
        assert!(WorkspaceState::additional_dirs().is_empty());
        // 恢复主工作区状态,不影响其他用例。
        WorkspaceState::set(PathBuf::from("/tmp/zhuye-workspace-state-test"));
    }

    #[test]
    fn pick_last_used_prefers_recent_non_hidden_existing() {
        // /tmp 稳定存在;不存在路径被过滤 —— 三个过滤维度各占一条。
        let raw = r#"[
            {"path":"/tmp","label":"tmp","last_used":10,"session_count":0,"hidden":false},
            {"path":"/tmp","label":"tmp-old","last_used":99,"session_count":0,"hidden":true},
            {"path":"/tmp/zhuye-restore-missing-dir","label":"ghost","last_used":50,"session_count":0,"hidden":false}
        ]"#;
        assert_eq!(pick_last_used(raw), Some(PathBuf::from("/tmp")));
    }

    #[test]
    fn pick_last_used_all_hidden_or_broken_yields_none() {
        assert_eq!(pick_last_used("[]"), None);
        assert_eq!(pick_last_used("not json"), None);
        let raw = r#"[{"path":"/tmp","label":"h","last_used":1,"session_count":0,"hidden":true}]"#;
        assert_eq!(pick_last_used(raw), None);
    }

    #[test]
    fn pick_last_used_missing_fields_default_to_zero_visible() {
        // serde default:无 last_used / 无 hidden 的记录 = 可选的零分候选。
        let raw = r#"[{"path":"/tmp","label":"bare"}]"#;
        assert_eq!(pick_last_used(raw), Some(PathBuf::from("/tmp")));
    }
}
