//! 工作区状态管理 —— 维护全局工作区路径覆盖。
//!
//! 通过 `once_cell::Lazy` 单例 + `RwLock` 提供跨线程安全的
//! workspace override 读写。优先级高于启动时捕获的 cwd。

use std::path::{Path, PathBuf};

use once_cell::sync::Lazy;
use parking_lot::RwLock;

static WORKSPACE_OVERRIDE: Lazy<RwLock<Option<PathBuf>>> = Lazy::new(|| RwLock::new(None));

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
}
