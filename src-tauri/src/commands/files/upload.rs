//! 上传附件落盘(`reflect_ingest_upload`)—— Composer 文件按钮 / 粘贴 /
//! DOM 拖入兜底共用的「字节 → 工作区内真实路径」管线。
//!
//! 浏览器侧 `<input type=file>` / clipboardData 只给字节不给路径,而引擎
//! `UserInputItem::File` 与 `/read` 工具都按**路径**消费(agent 按需读取,
//! 沙箱要求 workspace 内)。因此把字节落盘到当前工作区的
//! `<workspace>/.zhuye/uploads/` 再返回路径 —— 既绕开 webview 拿不到路径
//! 的限制,又保证 agent 后续一定能读到。
//!
//! 目录推导走 `reflect_config::paths::project_data_path`(架构红线:路径
//! 只经 reflect_config::paths,不自拼目录名)。

use std::path::PathBuf;

use serde::Serialize;
use tauri::State;

use crate::commands::error::{CommandError, CommandResult};
use crate::state::MinimalAgent;

/// `reflect_ingest_upload` 的返回:落盘后的绝对路径与字节数。
#[derive(Debug, Serialize)]
pub struct IngestUploadResult {
    /// 落盘文件的绝对路径(`<workspace>/.zhuye/uploads/<ts>_<name>`)。
    pub path: String,
    /// 写入字节数。
    pub size: u64,
}

/// 64 MiB:与常见 chat 附件上限对齐;再大的文件应改用原生拖拽/`@` 引用。
const INGEST_MAX: usize = 64 * 1_048_576;

/// 净化文件名:去掉路径分隔符与目录穿越片段,只保留文件名部分。
/// 空结果(如输入全是 `/`)回落 `upload.bin`。
fn sanitize_filename(raw: &str) -> String {
    let base = raw
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .trim()
        .trim_start_matches('.')
        .to_string();
    let cleaned: String = base
        .chars()
        // 控制字符与路径保留字符替换为 `_`,防跨平台怪异文件名。
        .map(|c| {
            if c.is_control() || matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.trim().to_string();
    if cleaned.is_empty() {
        "upload.bin".to_string()
    } else {
        cleaned
    }
}

/// 把 webview 侧拿到的文件字节落盘到工作区 uploads 目录,返回真实路径。
///
/// - base64 经 agent.rs 的内置解码器(与 `normalize_image_data` 同源);
/// - 文件名净化后加毫秒时间戳前缀防覆盖;
/// - 超过 [`INGEST_MAX`] 直接拒绝,防 IPC payload 失控。
#[tauri::command]
pub async fn reflect_ingest_upload(
    agent: State<'_, MinimalAgent>,
    filename: String,
    base64: String,
) -> CommandResult<IngestUploadResult> {
    let bytes = crate::commands::agent::base64_decode(&base64).ok_or_else(|| CommandError {
        msg: "invalid base64 payload".into(),
    })?;
    if bytes.len() > INGEST_MAX {
        return Err(CommandError {
            msg: format!("upload too large: {} bytes (max {INGEST_MAX})", bytes.len()),
        });
    }
    let dir: PathBuf = reflect_config::paths::project_data_path(&agent.workspace(), &["uploads"]);
    std::fs::create_dir_all(&dir).map_err(CommandError::from)?;
    let name = format!(
        "{}_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0),
        sanitize_filename(&filename)
    );
    let path = dir.join(name);
    std::fs::write(&path, &bytes).map_err(CommandError::from)?;
    Ok(IngestUploadResult {
        path: path.display().to_string(),
        size: bytes.len() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_paths_and_traversal() {
        assert_eq!(sanitize_filename("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_filename("a/b\\c.txt"), "c.txt");
        // `:` 与 `?` 各替换为一个 `_`。
        assert_eq!(sanitize_filename("报告:final?.pdf"), "报告_final_.pdf");
        assert_eq!(sanitize_filename("..."), "upload.bin");
        assert_eq!(sanitize_filename("/"), "upload.bin");
    }
}
