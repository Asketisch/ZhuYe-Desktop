//! 会话 sidecar 文件（`_names/<id>.name`、`_titles/<id>.title`）落盘前的链接校验。
//!
//! 核心 rollout 按路径写这两个文件，会**跟随符号链接**：工作树里只要放一个
//! `<session-id>.name → /outside/protected`，一次改名或一次 AI 标题写入就变成
//! 覆盖工作区外任意可写文件。桌面端不复制一份 sidecar 写入逻辑（真值格式归
//! 核心），改为在调用核心之前校验链接位。
//!
//! 残留窗口：校验与核心写入之间若被替换成链接，仍会跟随 —— 这一段要在
//! `zhuye-rollout` 内部固定句柄才能根治（见 `docs/CAPABILITIES.md` §4.2）。

use std::path::Path;

use crate::commands::error::{CommandError, CommandResult};

/// `path` 及其父目录若已存在，必须不是符号链接 / 重解析点。
pub(super) fn reject_links(path: &Path) -> CommandResult<()> {
    if let Some(dir) = path.parent() {
        reject_self_link(dir)?;
    }
    reject_self_link(path)
}

fn reject_self_link(path: &Path) -> CommandResult<()> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if is_link_or_reparse(&metadata) => Err(CommandError {
            msg: format!("会话 sidecar 路径是符号链接，拒绝写入: {}", path.display()),
        }),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(CommandError::from(error)),
    }
}

fn is_link_or_reparse(metadata: &std::fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn a_linked_sidecar_is_rejected_before_the_write() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let target = outside.path().join("protected");
        std::fs::write(&target, "original").unwrap();
        let names = dir.path().join("_names");
        std::fs::create_dir_all(&names).unwrap();
        let link = names.join("session-1.name");
        symlink(&target, &link).unwrap();
        assert!(reject_links(&link).is_err());
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "original");
    }

    #[test]
    fn a_linked_sidecar_directory_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(outside.path().join("_names")).unwrap();
        symlink(outside.path().join("_names"), dir.path().join("_names")).unwrap();
        assert!(reject_links(&dir.path().join("_names").join("session-1.name")).is_err());
    }

    #[test]
    fn missing_or_plain_paths_pass() {
        let dir = tempfile::tempdir().unwrap();
        let names = dir.path().join("_names");
        assert!(reject_links(&names.join("session-1.name")).is_ok());
        std::fs::create_dir_all(&names).unwrap();
        std::fs::write(names.join("session-1.name"), "name").unwrap();
        assert!(reject_links(&names.join("session-1.name")).is_ok());
    }
}
