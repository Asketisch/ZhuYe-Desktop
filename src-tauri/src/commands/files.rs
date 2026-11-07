//! 文件树 (`reflect_list_dir`) + 文本读 (`reflect_read_file`) + 写回
//! (`reflect_write_file`)。
//!
//! 共享的过滤 / 排序辅助函数给 `search.rs` 复用；图片附件读取在
//! [`image`] 子模块 —— 不走工作区沙盒的独立域。

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::error::{CommandError, CommandResult};
use crate::state::MinimalAgent;

/// 返回给前端的目录条目。
#[derive(Debug, Serialize, Deserialize)]
pub struct DirEntry {
    /// 文件 / 目录名(非完整路径)。
    pub name: String,
    /// 绝对路径。
    pub path: String,
    /// 取值 `"file" | "dir" | "symlink"`。
    pub kind: String,
    /// 文件字节数(目录时为 0)。
    pub size: u64,
    /// Unix mtime,自 epoch 起秒数。
    pub mtime: i64,
    /// 距所请求根目录的层级(0 表示根目录的直接内容)。
    pub depth: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DirListing {
    pub root: String,
    pub entries: Vec<DirEntry>,
    pub truncated: bool,
}

/// 列出目录内容。跳过隐藏文件 / 常见重型目录(`node_modules`、`.git`、`target` 等)。
/// `max_depth` 默认 4,返回条目上限 2_000,避免 payload 过大。
///
/// 路径与 `reflect_read_file` / `reflect_write_file` 同一条沙盒规则:解析后必须
/// 落在工作区内,否则拒绝 —— 目录列表本身就是文件内容枚举面,不能比读取更宽。
#[tauri::command]
pub async fn reflect_list_dir(
    agent: State<'_, MinimalAgent>,
    path: Option<String>,
    max_depth: Option<usize>,
) -> CommandResult<DirListing> {
    let requested = path.as_deref().unwrap_or("");
    let root = resolve_under_workspace(&agent.workspace(), requested)?;
    if !root.is_dir() {
        return Err(CommandError {
            msg: format!("not a directory: {}", root.display()),
        });
    }
    let max_d = max_depth.unwrap_or(4);
    let mut entries: Vec<DirEntry> = Vec::new();
    let mut truncated = false;
    const CAP: usize = 2_000;
    walk_dir(&root, 0, max_d, &mut entries, &mut truncated, CAP);
    Ok(DirListing {
        root: root.display().to_string(),
        entries,
        truncated,
    })
}

fn walk_dir(
    dir: &Path,
    depth: usize,
    max_depth: usize,
    out: &mut Vec<DirEntry>,
    truncated: &mut bool,
    cap: usize,
) {
    if *truncated {
        return;
    }
    let read = match std::fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return,
    };
    let mut sorted: Vec<_> = read.filter_map(|e| e.ok()).collect();
    sorted.sort_by_key(|e| std::cmp::Reverse(depth_first_sort_key(e)));
    for entry in sorted {
        if *truncated {
            return;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if should_skip(&name) {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if out.len() >= cap {
            *truncated = true;
            return;
        }
        let path = entry.path();
        let kind = if meta.is_dir() {
            "dir"
        } else if meta.file_type().is_symlink() {
            "symlink"
        } else {
            "file"
        };
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_secs() as i64);
        out.push(DirEntry {
            name,
            path: path.display().to_string(),
            kind: kind.to_string(),
            size: if meta.is_dir() { 0 } else { meta.len() },
            mtime,
            depth,
        });
        if kind == "dir" && depth + 1 < max_depth {
            walk_dir(&path, depth + 1, max_depth, out, truncated, cap);
        }
    }
}

pub(crate) fn depth_first_sort_key(entry: &std::fs::DirEntry) -> (u8, String) {
    let name = entry.file_name().to_string_lossy().to_string();
    let is_dir = entry
        .file_type()
        .map_or(1, |t| if t.is_dir() { 0 } else { 1 });
    (is_dir, name.to_ascii_lowercase())
}

pub(crate) fn should_skip(name: &str) -> bool {
    if name.starts_with('.') {
        return true;
    }
    matches!(
        name,
        "node_modules" | "target" | "dist" | "build" | "__pycache__" | "venv" | ".next" | ".cache"
    )
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileReadResult {
    pub path: String,
    pub content: String,
    pub size: u64,
    pub binary: bool,
    pub truncated: bool,
}

const FILE_READ_MAX: u64 = 1_048_576; // 1 MiB

/// 读取文本文件。超过 `FILE_READ_MAX` 时返回截断预览；含 NUL 或非 UTF-8
/// 数据视为二进制，避免有损解码后将替换字符写回原文件。
#[tauri::command]
pub async fn reflect_read_file(
    agent: State<'_, MinimalAgent>,
    path: String,
) -> CommandResult<FileReadResult> {
    let resolved = resolve_under_workspace(&agent.workspace(), &path)?;
    let mut f = std::fs::File::open(&resolved).map_err(CommandError::from)?;
    let meta = f.metadata().map_err(CommandError::from)?;
    if !meta.is_file() {
        return Err(CommandError {
            msg: format!("not a file: {}", resolved.display()),
        });
    }
    let (bytes, mut truncated, mut size) = read_file_preview(&mut f, meta.len())?;
    let final_size = f.metadata()?.len();
    // 文件读完后又增长时，当前缓冲区依然不完整，必须保持只读。
    truncated |= final_size > bytes.len() as u64;
    size = size.max(final_size);

    let (content, binary) = decode_file_content(&bytes, truncated);
    Ok(FileReadResult {
        path: resolved.display().to_string(),
        content,
        size,
        binary,
        truncated,
    })
}

fn read_file_preview(
    reader: &mut impl Read,
    initial_size: u64,
) -> std::io::Result<(Vec<u8>, bool, u64)> {
    let mut bytes = Vec::new();
    reader.take(FILE_READ_MAX + 1).read_to_end(&mut bytes)?;
    let observed_size = bytes.len() as u64;
    let truncated = initial_size > FILE_READ_MAX || observed_size > FILE_READ_MAX;
    bytes.truncate(FILE_READ_MAX as usize);
    Ok((bytes, truncated, initial_size.max(observed_size)))
}

fn decode_file_content(bytes: &[u8], truncated: bool) -> (String, bool) {
    if bytes.contains(&0) {
        return (String::new(), true);
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => (text.to_owned(), false),
        // 截断预览可能恰好在多字节字符中间结束；保留完整字符的前缀。
        Err(error) if truncated && error.error_len().is_none() => (
            String::from_utf8_lossy(&bytes[..error.valid_up_to()]).into_owned(),
            false,
        ),
        Err(_) => (String::new(), true),
    }
}

/// 写回文本文件(编辑器 Reject 恢复原文 / 手动保存)。工作区沙盒内。
///
/// 供编辑器把恢复后的内容写回磁盘:`Reject` 会用 inverse-patch 重建原文,
/// 经此命令落盘。文件不存在时创建(含父目录);按 UTF-8 覆盖写。
#[tauri::command]
pub async fn reflect_write_file(
    agent: State<'_, MinimalAgent>,
    path: String,
    content: String,
) -> CommandResult<String> {
    let resolved = resolve_under_workspace(&agent.workspace(), &path)?;
    if let Some(parent) = resolved.parent() {
        std::fs::create_dir_all(parent).map_err(CommandError::from)?;
    }
    atomic_write(&resolved, content.as_bytes()).map_err(CommandError::from)?;
    tracing::info!(path = %resolved.display(), bytes = content.len(), "file written");
    Ok(resolved.display().to_string())
}

/// 同目录临时文件 + rename 的原子写。
///
/// `std::fs::write` 先截断目标再写：进程在写入中途被杀 / 崩溃，用户文件就只剩
/// 半截内容。rename 让旧文件在新内容完整落盘前一直可见；失败时清掉临时文件，
/// 成功后复制旧文件的权限位（否则覆盖一个 `0755` 脚本会把可执行位丢掉）。
///
/// 与 `crate::persistence::write_atomic` 的区别：那个给桌面自有状态文件用，
/// 新文件固定 0600；工作区里的新文件必须跟随 umask（与 `fs::write` 一致），
/// 否则编辑器新建的文件对其他用户不可读。
fn atomic_write(path: &Path, content: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path
        .file_name()
        .map_or_else(|| "file".to_string(), |n| n.to_string_lossy().into_owned());
    let temp = parent.join(format!(".{stem}.{}.tmp", uuid::Uuid::new_v4()));
    let existing = std::fs::metadata(path).ok();
    if let Some(meta) = &existing {
        if meta.permissions().readonly() {
            // rename 只看目录权限；只读目标必须像 `fs::write` 一样报错，
            // 不能被静默解锁覆盖。
            let _ = std::fs::remove_file(&temp);
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                format!("file is read-only: {}", path.display()),
            ));
        }
    }
    let preserve = existing.map(|m| m.permissions());
    let write = (|| -> std::io::Result<()> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(content)?;
        file.flush()?;
        file.sync_all()?;
        drop(file);
        if let Some(permissions) = preserve {
            std::fs::set_permissions(&temp, permissions)?;
        }
        std::fs::rename(&temp, path)?;
        Ok(())
    })();
    if write.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    write
}

/// 确保 `path` 解析后位于已配置的工作区之下,
/// 防止 `..` 逃逸以及指向工作区外的绝对路径。
pub(crate) fn resolve_under_workspace(workspace: &Path, path: &str) -> CommandResult<PathBuf> {
    let p = Path::new(path);
    // `..` 组件一律拒绝:目标文件尚不存在时 canonicalize 失败会退回原始
    // join 路径,而 `Path::starts_with` 是纯词法前缀比较,
    // `ws/../etc/x` 这类路径会绕过校验被写到工作区外。
    if p.components().any(|c| c == std::path::Component::ParentDir) {
        return Err(CommandError {
            msg: format!("path must not contain '..': {path}"),
        });
    }
    let joined = if p.is_absolute() {
        p.to_path_buf()
    } else {
        workspace.join(p)
    };
    let canon_workspace = std::fs::canonicalize(workspace).map_err(CommandError::from)?;
    // 从目标向上寻找存在的祖先。悬空符号链接本身也算存在，必须拒绝
    // 无法解析的链接，不能退回词法路径后让写入操作跟随它。
    let mut canon_joined = None;
    for ancestor in joined.ancestors() {
        match std::fs::symlink_metadata(ancestor) {
            Ok(_) => {
                let canon = std::fs::canonicalize(ancestor).map_err(CommandError::from)?;
                let suffix = joined.strip_prefix(ancestor).map_err(|e| CommandError {
                    msg: format!("invalid path: {e}"),
                })?;
                // 给普通文件追加空路径会产生末尾分隔符，随后读取会报 ENOTDIR。
                canon_joined = Some(if suffix.as_os_str().is_empty() {
                    canon
                } else {
                    canon.join(suffix)
                });
                break;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(CommandError::from(e)),
        }
    }
    let canon_joined = canon_joined.ok_or_else(|| CommandError {
        msg: format!("cannot resolve path: {}", joined.display()),
    })?;
    if !canon_joined.starts_with(&canon_workspace) {
        return Err(CommandError {
            msg: format!(
                "path escapes workspace: {} (workspace={})",
                canon_joined.display(),
                canon_workspace.display()
            ),
        });
    }
    Ok(canon_joined)
}

/// 图片附件读取是独立的域(不走工作区沙盒),见 [`image`] 子模块。
mod image;

pub use image::{ImageBase64Result, reflect_read_image_base64};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolving_existing_file_preserves_readable_path() {
        let workspace = tempfile::tempdir().unwrap();
        std::fs::write(workspace.path().join("note.txt"), "hello").unwrap();
        let path = resolve_under_workspace(workspace.path(), "note.txt").unwrap();
        assert_eq!(std::fs::read_to_string(path).unwrap(), "hello");
    }

    #[test]
    fn atomic_write_replaces_content_and_leaves_no_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("note.txt");
        atomic_write(&target, b"first").unwrap();
        atomic_write(&target, b"second").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"second");
        let leftovers: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with('.'))
            .collect();
        assert!(
            leftovers.is_empty(),
            "temp files left behind: {leftovers:?}"
        );
    }

    #[test]
    fn atomic_write_refuses_a_read_only_target() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("locked.txt");
        std::fs::write(&target, "original").unwrap();
        let mut permissions = std::fs::metadata(&target).unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&target, permissions).unwrap();
        let error = atomic_write(&target, b"override").unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::PermissionDenied);
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "original");
        assert_eq!(
            std::fs::read_dir(dir.path()).unwrap().count(),
            1,
            "read-only refusal must not leave a temp file"
        );
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_keeps_the_existing_file_mode() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("run.sh");
        std::fs::write(&target, b"#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755)).unwrap();
        atomic_write(&target, b"#!/bin/sh\necho hi\n").unwrap();
        assert_eq!(
            std::fs::metadata(&target).unwrap().permissions().mode() & 0o777,
            0o755,
            "rename-based write must not drop the executable bit"
        );
    }

    #[test]
    fn preview_detects_growth_after_the_initial_size_check() {
        let mut small = std::io::Cursor::new(b"expanded".to_vec());
        let (bytes, truncated, size) = read_file_preview(&mut small, 1).unwrap();
        assert_eq!(bytes, b"expanded");
        assert!(!truncated);
        assert_eq!(size, 8);

        let mut large = std::io::Cursor::new(vec![b'x'; FILE_READ_MAX as usize + 1]);
        let (bytes, truncated, size) = read_file_preview(&mut large, 1).unwrap();
        assert_eq!(bytes.len(), FILE_READ_MAX as usize);
        assert!(truncated);
        assert_eq!(size, FILE_READ_MAX + 1);
    }

    #[test]
    fn directory_truncation_requires_an_extra_visible_entry() {
        let workspace = tempfile::tempdir().unwrap();
        std::fs::create_dir(workspace.path().join("empty")).unwrap();
        std::fs::write(workspace.path().join(".hidden"), "ignored").unwrap();
        let mut entries = Vec::new();
        let mut truncated = false;
        walk_dir(workspace.path(), 0, 4, &mut entries, &mut truncated, 1);
        assert_eq!(entries.len(), 1);
        assert!(!truncated);

        std::fs::write(workspace.path().join("empty").join("visible"), "x").unwrap();
        let mut entries = Vec::new();
        let mut truncated = false;
        walk_dir(workspace.path(), 0, 4, &mut entries, &mut truncated, 1);
        assert_eq!(entries.len(), 1);
        assert!(truncated);
    }

    #[cfg(unix)]
    #[test]
    fn workspace_resolution_rejects_dangling_symlink() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let workspace = dir.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        symlink(dir.path().join("outside"), workspace.join("link")).unwrap();
        assert!(resolve_under_workspace(&workspace, "link").is_err());
        assert!(resolve_under_workspace(&workspace, "link/child").is_err());
        assert!(resolve_under_workspace(&workspace, "new/child").is_ok());
    }

    #[test]
    fn decoding_rejects_lossy_content_and_preserves_truncated_utf8_prefix() {
        assert_eq!(decode_file_content(b"a\xffb", false), (String::new(), true));
        let mut with_nul = vec![b'a'; 9000];
        with_nul.push(0);
        assert!(decode_file_content(&with_nul, false).1);
        assert_eq!(
            decode_file_content(b"hello\xe4\xb8", true),
            ("hello".into(), false)
        );
        assert!(decode_file_content(b"hello\xe4\xb8", false).1);
        assert!(decode_file_content(b"hello\xff", true).1);
    }
}
