//! 桌面状态文件的完整写入和替换。

use std::fs::File;
use std::io::{self, Write};
use std::path::Path;

/// 覆盖式原子写：先把完整内容写进同目录临时文件，再替换目标。
pub(crate) fn write_atomic(path: &Path, content: &[u8]) -> io::Result<()> {
    write_atomic_with(path, |file| file.write_all(content))
}

/// 写完整并同步临时文件后替换目标；现有符号链接继续指向原目标。
///
/// 直接 `fs::write` 会先截断目标：进程中途退出就留下半截文件；解析偏好时
/// 坏文件会被静默替换成默认值，用户数据就此丢失。这里失败即保留原文件。
pub(crate) fn write_atomic_with(
    path: &Path,
    write: impl FnOnce(&mut File) -> io::Result<()>,
) -> io::Result<()> {
    let target = match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => path.canonicalize()?,
        Ok(_) => path.to_path_buf(),
        Err(error) if error.kind() == io::ErrorKind::NotFound => path.to_path_buf(),
        Err(error) => return Err(error),
    };
    let parent = target
        .parent()
        .ok_or_else(|| io::Error::other("state file has no parent directory"))?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    match std::fs::metadata(&target) {
        Ok(metadata) => {
            if metadata.permissions().readonly() {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "state file is read-only",
                ));
            }
            // 原子重命名只看目录权限，这里额外确认目标本身可写。
            std::fs::OpenOptions::new().write(true).open(&target)?;
            temp.as_file().set_permissions(metadata.permissions())?;
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    write(temp.as_file_mut())?;
    temp.as_file().sync_all()?;
    temp.persist(&target).map_err(|error| error.error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    use std::os::unix::fs::{PermissionsExt, symlink};

    use super::*;
    use std::path::PathBuf;

    fn temp_path() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        (dir, path)
    }

    #[test]
    fn failed_write_preserves_original_and_removes_temporary_file() {
        let (dir, path) = temp_path();
        std::fs::write(&path, "original").unwrap();
        let error = write_atomic_with(&path, |file| {
            file.write_all(b"partial")?;
            Err(io::Error::other("simulated write failure"))
        })
        .unwrap_err();
        assert!(error.to_string().contains("simulated write failure"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "original");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn write_replaces_content_and_leaves_no_temporary_file() {
        let (dir, path) = temp_path();
        write_atomic(&path, b"first").unwrap();
        write_atomic(&path, b"second").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "second");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn read_only_target_is_not_replaced() {
        let (_dir, path) = temp_path();
        std::fs::write(&path, "original").unwrap();
        let mut permissions = std::fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&path, permissions).unwrap();
        let error = write_atomic(&path, b"new").unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
        // 重命名只查目录权限：只读目标必须原样保留，不能被静默覆盖。
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "original");
    }

    #[cfg(unix)]
    #[test]
    fn write_preserves_symlink_and_permissions() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("actual.json");
        let link = dir.path().join("state.json");
        std::fs::write(&target, "original").unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o640)).unwrap();
        symlink("actual.json", &link).unwrap();
        write_atomic(&link, b"updated").unwrap();
        assert!(
            std::fs::symlink_metadata(&link)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "updated");
        assert_eq!(
            std::fs::metadata(&target).unwrap().permissions().mode() & 0o777,
            0o640,
            "atomic replace must not widen the file mode"
        );
    }
}
