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

pub(crate) fn same_path(a: &Path, b: &Path) -> bool {
    a == b || matches!((a.canonicalize(), b.canonicalize()), (Ok(a), Ok(b)) if a == b)
}

pub(crate) struct WorkspaceState;

impl WorkspaceState {
    pub(crate) fn set(path: PathBuf) {
        *WORKSPACE_OVERRIDE.write() = Some(path);
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
        let path = PathBuf::from("/tmp/reflect-workspace-state-test");
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
        assert_eq!(WorkspaceState::additional_dirs(), vec![PathBuf::from("/tmp/extra-c")]);
        // 清空(切换主工作区时)。
        WorkspaceState::set_additional_dirs(Vec::new());
        assert!(WorkspaceState::additional_dirs().is_empty());
        // 恢复主工作区状态,不影响其他用例。
        WorkspaceState::set(PathBuf::from("/tmp/reflect-workspace-state-test"));
    }
}
