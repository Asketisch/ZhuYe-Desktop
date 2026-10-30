//! 图片附件读取(`reflect_read_image_base64`)—— Composer 拖拽/选择器管线用。
//!
//! 与本目录其余命令(工作区沙盒内的文件树 / 文本读写)是两个刻意分开的域:
//! 附件来源可以是 Desktop / Downloads 等任意位置,不走工作区沙盒。

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::commands::error::{CommandError, CommandResult};

/// `reflect_read_image_base64` 的返回:图片字节(base64)+ MIME。
#[derive(Debug, Serialize)]
pub struct ImageBase64Result {
    /// 文件绝对路径。
    pub path: String,
    /// 按扩展名推断的 MIME(`image/png` 等)。
    pub mime_type: String,
    /// 文件字节的 base64 编码(不带 data-URL 前缀)。
    pub base64: String,
    /// 原始字节数。
    pub size: u64,
}

/// 20 MiB:provider vision 接口的实际上限远小于此;再大的文件几乎必然
/// 是用户拖错东西,直接拒绝而不是让 IPC payload 失控。
const IMAGE_READ_MAX: u64 = 20 * 1_048_576;

/// 按扩展名推断图片 MIME;非白名单扩展返回 `None`。
fn image_mime_by_extension(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => return None,
    })
}

/// 读取图片文件并返回 base64 —— Composer 拖拽/选择器附件管线用。
///
/// 与 `reflect_read_file` 的两个刻意差异:
/// - **不做工作区沙盒**:拖拽来源可以是 Desktop / Downloads 等任意位置,
///   沙盒会让主用例(拖张截图进来)直接失败;
/// - **扩展名白名单 + 20 MiB 上限**:core 侧 `UserInputItem::LocalImage`
///   尚未接通(submission_loop 静默跳过),前端必须拿到字节以 inline
///   `Image` item 提交 —— 这里挡住非图片与大文件,防 IPC payload 失控。
#[tauri::command]
pub async fn reflect_read_image_base64(path: String) -> CommandResult<ImageBase64Result> {
    let p = PathBuf::from(&path);
    let Some(mime) = image_mime_by_extension(&p) else {
        return Err(CommandError {
            msg: format!("not a supported image file: {path} (expected png/jpg/jpeg/gif/webp/bmp)"),
        });
    };
    let meta = std::fs::metadata(&p).map_err(CommandError::from)?;
    if !meta.is_file() {
        return Err(CommandError {
            msg: format!("not a file: {}", p.display()),
        });
    }
    if meta.len() > IMAGE_READ_MAX {
        return Err(CommandError {
            msg: format!(
                "image too large: {} bytes (max {IMAGE_READ_MAX})",
                meta.len()
            ),
        });
    }
    let bytes = std::fs::read(&p).map_err(CommandError::from)?;
    Ok(ImageBase64Result {
        path: p.display().to_string(),
        mime_type: mime.to_string(),
        base64: crate::commands::media::base64_encode(&bytes),
        size: meta.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_mime_by_extension_maps_whitelist() {
        assert_eq!(
            image_mime_by_extension(Path::new("/tmp/a.PNG")),
            Some("image/png")
        );
        assert_eq!(
            image_mime_by_extension(Path::new("/tmp/b.jpeg")),
            Some("image/jpeg")
        );
        assert_eq!(
            image_mime_by_extension(Path::new("/tmp/c.webp")),
            Some("image/webp")
        );
        assert_eq!(image_mime_by_extension(Path::new("/tmp/d.txt")), None);
        assert_eq!(image_mime_by_extension(Path::new("/tmp/noext")), None);
    }

    #[test]
    fn read_image_base64_round_trip() {
        let dir = std::env::temp_dir().join("reflect-files-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("reflect_read_image_base64.png");
        std::fs::write(&path, [0x89u8, b'P', b'N', b'G']).unwrap();
        let res = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(reflect_read_image_base64(path.display().to_string()))
            .unwrap();
        assert_eq!(res.mime_type, "image/png");
        assert_eq!(res.size, 4);
        // 4 字节 → base64 为 8 字符(无 padding,ceil(4/3)*4)。
        assert_eq!(res.base64.len(), 8);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn read_image_base64_rejects_non_image() {
        let err = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(reflect_read_image_base64(
                "/tmp/reflect-not-an-image.txt".into(),
            ))
            .unwrap_err();
        assert!(err.msg.contains("not a supported image file"));
    }
}
