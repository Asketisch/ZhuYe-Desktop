//! 会话 sidecar 文件（`_names/<id>.name`、`_titles/<id>.title`）的
//! 链接校验与安全写入。
//!
//! 核心按路径写这两个文件时会**跟随符号链接**：工作树里只要放一个
//! `<session-id>.name → /outside/protected`，一次改名或一次 AI 标题写入
//! 就变成覆盖工作区外任意可写文件。桌面端在写入前校验链接位，把用户
//! 错误提前暴露。
//!
//! develop 起核心已移除 `write_session_sidecar`（标题生成是桌面端
//! 特性），`_titles` 落盘由本模块承担：同目录临时文件 + `persist`
//! （rename）原子替换。rename 永不写穿目标 —— 即使预检后路径被并发
//! 换成 symlink，也只是把链接替换为普通文件，不会写到工作区外。

use std::io::Write;
use std::path::Path;

use reflect_protocol::ThreadId;

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

/// 会话 sidecar 原子写入：`<base>/_<kind>s/<id>.<kind>`
/// （kind = "title" → `_titles/<id>.title`，"name" → `_names/<id>.name`）。
///
/// 与旧的 `fs::write` 不同：`fs::write` 会先截断目标并跟随链接；这里
/// 写同目录临时文件后 rename 替换，半截文件与链接写穿都不可能发生。
pub(super) fn write_session_sidecar(
    base: &Path,
    id: ThreadId,
    kind: &str,
    content: &[u8],
) -> std::io::Result<()> {
    // 目录名是复数(`_titles` / `_names`),文件名是单数扩展名。
    let dir = base.join(format!("_{kind}s"));
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{id}.{kind}"));
    reject_links(&path).map_err(|error| std::io::Error::other(error.msg))?;
    let mut temp = tempfile::NamedTempFile::new_in(&dir)?;
    temp.as_file_mut().write_all(content)?;
    temp.as_file().sync_all()?;
    temp.persist(&path).map_err(|error| error.error)?;
    Ok(())
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

    fn thread_id(seed: &str) -> ThreadId {
        ThreadId::parse_str(seed).unwrap()
    }

    /// develop 收编修复的主断言:写入落在复数目录 `_titles/<id>.title`,
    /// 内容完整、可覆盖重写,且不残留临时文件。
    #[test]
    fn write_session_sidecar_lands_at_the_plural_dir_and_overwrites() {
        let base = tempfile::tempdir().unwrap();
        let id = thread_id("11111111-2222-3333-4444-555555555555");
        write_session_sidecar(base.path(), id, "title", b"first").unwrap();
        let path = base.path().join("_titles").join(format!("{id}.title"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "first");
        // 原子替换:重写覆盖,不留 tempfile 残渣。
        write_session_sidecar(base.path(), id, "title", b"second title").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "second title");
        assert_eq!(
            std::fs::read_dir(base.path().join("_titles"))
                .unwrap()
                .count(),
            1
        );
    }

    /// 链接位拒绝在**写入路径**生效:目标已是 symlink 时整个写入报错,
    /// 链接外面的真实文件原样保留。
    #[test]
    fn write_session_sidecar_rejects_a_linked_target_without_touching_it() {
        let base = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let protected = outside.path().join("protected");
        std::fs::write(&protected, "original").unwrap();
        let titles = base.path().join("_titles");
        std::fs::create_dir_all(&titles).unwrap();
        let id = thread_id("22222222-3333-4444-5555-666666666666");
        symlink(&protected, titles.join(format!("{id}.title"))).unwrap();

        let error = write_session_sidecar(base.path(), id, "title", b"evil").unwrap_err();
        assert!(
            error.to_string().contains("符号链接"),
            "错误应说明链接拒绝: {error}"
        );
        assert_eq!(std::fs::read_to_string(&protected).unwrap(), "original");
    }

    /// 目录本身是链接时同样拒绝(防 `_titles → /outside` 整目录劫持)。
    #[test]
    fn write_session_sidecar_rejects_a_linked_directory() {
        let base = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let linked_titles = outside.path().join("_titles");
        std::fs::create_dir_all(&linked_titles).unwrap();
        symlink(&linked_titles, base.path().join("_titles")).unwrap();
        let id = thread_id("33333333-4444-5555-6666-777777777777");
        let error = write_session_sidecar(base.path(), id, "title", b"x").unwrap_err();
        assert!(error.to_string().contains("符号链接"), "{error}");
        // 链接指向的目录里什么都没写进去。
        assert_eq!(std::fs::read_dir(&linked_titles).unwrap().count(), 0);
    }
}
