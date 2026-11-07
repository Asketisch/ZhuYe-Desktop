//! 真实的 Media Studio + Computer Use backend 实现。
//!
//! 用 `image` crate (`ImageBackend`) + `xcap`/`enigo` (`ComputerBackend`)
//! 替换默认的 metadata-only / unavailable 实现。
//!
//! ## 平台
//!
//! - **ImageBackend** —— 跨平台(`image` crate)。
//! - **ComputerBackend** —— macOS / Windows / Linux 都由 xcap + enigo 处理;
//!   macOS 首次调用 `Enigo::new()` 时会触发权限弹窗(若需要)。
//!
//! ## 失败模式
//!
//! - 截屏失败(权限拒绝 / 无显示) → `MediaError::Unavailable`。
//! - `Enigo::new()` 没权限 → `MediaError::Unavailable { capability: "input_permission" }`。
//! - 鼠标键盘动作实际错误 → `MediaError::Other`。

use std::io::{Cursor, Write};
use std::path::Path;

use enigo::{
    Axis::{Horizontal, Vertical},
    Button,
    Coordinate::Abs,
    Direction::{self, Click},
    Enigo, Key, Keyboard, Mouse, Settings,
};
use image::{DynamicImage, ImageFormat as ImgFmt};
use reflect_app_core::media::{
    BackendCapability, ComputerBackend, ComputerUseAction, ImageBackend, ImageFormat,
    ImageProcessResult, ImageProcessSpec, MediaAsset, MediaError,
};

/// 基于 `image` crate 的图像处理器。
///
/// Pure-local,不依赖 native binding。读取文件 → 解码为
/// [`image::DynamicImage`] → 缩放 → 写回为指定格式。
pub struct RealImageBackend;

impl RealImageBackend {
    pub fn new() -> Self {
        Self
    }
}

impl Default for RealImageBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl ImageBackend for RealImageBackend {
    fn capability(&self) -> BackendCapability {
        BackendCapability::Full
    }

    fn load_metadata(&self, path: &Path) -> Result<MediaAsset, MediaError> {
        let meta = std::fs::metadata(path).map_err(|e| MediaError::IoError {
            message: e.to_string(),
        })?;
        let filename = path
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| MediaError::Other {
                message: "invalid filename encoding".into(),
            })?
            .to_string();
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        let format = ImageFormat::from_ext(ext);
        let mime = format.map(crate_format_to_mime);
        let modified_at_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_millis() as u64);
        // 尽力读维(失败不算 error,返回 None)。
        let (width, height) = image::image_dimensions(path)
            .ok()
            .map_or((None, None), |(w, h)| (Some(w), Some(h)));
        Ok(MediaAsset {
            path: path.to_path_buf(),
            filename,
            size_bytes: meta.len(),
            mime_type: mime,
            width,
            height,
            modified_at_ms,
        })
    }

    fn process(&self, spec: &ImageProcessSpec) -> Result<ImageProcessResult, MediaError> {
        let input = Path::new(&spec.input_path);
        let output = Path::new(&spec.output_path);
        if !input.is_file() {
            return Err(MediaError::NotFound {
                message: format!("input not found: {}", input.display()),
            });
        }
        // 推断输出格式:spec.format 优先,否则用 output_path 的扩展名。
        let resolved_format = spec
            .format
            .or_else(|| {
                output
                    .extension()
                    .and_then(|e| e.to_str())
                    .and_then(ImageFormat::from_ext)
            })
            .ok_or_else(|| MediaError::UnsupportedFormat {
                message: "cannot infer output format from path or spec".into(),
            })?;

        let img = image::open(input).map_err(|e| MediaError::Other {
            message: format!("decode failed: {e}"),
        })?;

        // 缩放。尺寸来自 IPC,必须有上限(超大值会让 resize 分配
        // 巨大缓冲导致 OOM abort)且比例计算用 u64(u32 乘法会静默回绕)。
        const MAX_DIMENSION: u32 = 16384;
        for dim in [spec.width, spec.height].into_iter().flatten() {
            if dim == 0 || dim > MAX_DIMENSION {
                return Err(MediaError::Other {
                    message: format!("width/height must be in 1..={MAX_DIMENSION}, got {dim}"),
                });
            }
        }
        let scaled: DynamicImage = match (spec.width, spec.height) {
            (Some(w), Some(h)) => img.resize_exact(w, h, image::imageops::FilterType::Lanczos3),
            (Some(w), None) => {
                let h = ((img.height() as u64) * (w as u64) / (img.width().max(1) as u64))
                    .min(u32::MAX as u64) as u32;
                img.resize(w, h, image::imageops::FilterType::Lanczos3)
            }
            (None, Some(h)) => {
                let w = ((img.width() as u64) * (h as u64) / (img.height().max(1) as u64))
                    .min(u32::MAX as u64) as u32;
                img.resize(w, h, image::imageops::FilterType::Lanczos3)
            }
            (None, None) => img,
        };

        if let Some(parent) = output.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        // 编码可能在中途失败；先写同目录临时文件再替换，避免截断已有输出。
        let temp = output.with_file_name(format!(
            ".{}.{}.tmp",
            output
                .file_name()
                .map_or_else(|| "media".into(), |n| n.to_string_lossy().into_owned()),
            uuid::Uuid::new_v4()
        ));
        let mut buf = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| MediaError::IoError {
                message: e.to_string(),
            })?;
        let img_fmt = match resolved_format {
            ImageFormat::Png => ImgFmt::Png,
            ImageFormat::Jpeg => ImgFmt::Jpeg,
            ImageFormat::Gif => ImgFmt::Gif,
            ImageFormat::WebP => ImgFmt::WebP,
            ImageFormat::Bmp => ImgFmt::Bmp,
        };
        // JPEG 没有透明通道,走 rgb8;PNG 保留 alpha(to_rgb8 会把透明区填黑)。
        let encoded = if resolved_format == ImageFormat::Jpeg {
            scaled.to_rgb8().write_to(&mut buf, img_fmt)
        } else {
            scaled.to_rgba8().write_to(&mut buf, img_fmt)
        };
        encoded.map_err(|e| MediaError::Other {
            message: format!("encode failed: {e}"),
        })?;
        buf.flush().map_err(|e| MediaError::IoError {
            message: e.to_string(),
        })?;
        buf.sync_all().map_err(|e| MediaError::IoError {
            message: e.to_string(),
        })?;
        drop(buf);
        let bytes = std::fs::metadata(&temp).map_or(0, |m| m.len());
        if let Err(error) = std::fs::rename(&temp, output) {
            let _ = std::fs::remove_file(&temp);
            return Err(MediaError::IoError {
                message: error.to_string(),
            });
        }
        Ok(ImageProcessResult {
            output_path: spec.output_path.clone(),
            width: scaled.width(),
            height: scaled.height(),
            format: resolved_format,
            bytes,
        })
    }
}

fn crate_format_to_mime(f: ImageFormat) -> String {
    match f {
        ImageFormat::Png => "image/png".into(),
        ImageFormat::Jpeg => "image/jpeg".into(),
        ImageFormat::Gif => "image/gif".into(),
        ImageFormat::WebP => "image/webp".into(),
        ImageFormat::Bmp => "image/bmp".into(),
    }
}

/// `xcap` (截图) + `enigo` (鼠标键盘输入) 组合的真实 backend。
///
/// 每次操作都新建 `Enigo`(无状态 action),不持有跨调用状态。
pub struct RealComputerBackend;

impl RealComputerBackend {
    pub fn new() -> Self {
        Self
    }
}

impl Default for RealComputerBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl ComputerBackend for RealComputerBackend {
    fn capability(&self) -> BackendCapability {
        BackendCapability::Full
    }

    fn screenshot(&self) -> Result<Vec<u8>, MediaError> {
        let monitors = xcap::Monitor::all().map_err(|e| MediaError::Unavailable {
            capability: "screenshot".into(),
            reason: format!("xcap enumerate failed: {e}"),
        })?;
        let monitor = monitors.first().ok_or_else(|| MediaError::Unavailable {
            capability: "screenshot".into(),
            reason: "no monitors detected".into(),
        })?;
        let rgba = monitor.capture_image().map_err(|e| MediaError::Other {
            message: format!("capture_image failed: {e}"),
        })?;
        // Encode RGBA → PNG bytes(前端 base64 后就能当 data: URL 用)。
        let mut buf: Vec<u8> = Vec::new();
        {
            let mut cursor = Cursor::new(&mut buf);
            rgba.write_to(&mut cursor, ImgFmt::Png)
                .map_err(|e| MediaError::Other {
                    message: format!("png encode failed: {e}"),
                })?;
        }
        Ok(buf)
    }

    fn execute(&self, action: &ComputerUseAction) -> Result<(), MediaError> {
        match action {
            ComputerUseAction::Screenshot => {
                // `screenshot` 走 `screenshot()` 独立命令;这里报告重复请求。
                Err(MediaError::Other {
                    message: "use reflect_screenshot for captures".into(),
                })
            }
            ComputerUseAction::MouseMove { x, y } => {
                let mut enigo = make_enigo()?;
                enigo.move_mouse(*x, *y, Abs).map_err(input_err)
            }
            ComputerUseAction::MouseClick { x, y, button } => {
                let mut enigo = make_enigo()?;
                enigo.move_mouse(*x, *y, Abs).map_err(input_err)?;
                let btn = parse_button(button);
                enigo.button(btn, Click).map_err(input_err)
            }
            ComputerUseAction::KeyType { text } => {
                let mut enigo = make_enigo()?;
                enigo.text(text).map_err(input_err)
            }
            ComputerUseAction::KeyCombo { keys } => {
                let mut enigo = make_enigo()?;
                press_combo(&mut enigo, keys)
            }
            ComputerUseAction::Scroll { dx, dy } => {
                let mut enigo = make_enigo()?;
                let mut last_err: Option<MediaError> = None;
                if *dy != 0 {
                    if let Err(e) = enigo.scroll(*dy, Vertical) {
                        last_err = Some(input_err(e));
                    }
                }
                if *dx != 0 {
                    if let Err(e) = enigo.scroll(*dx, Horizontal) {
                        last_err = Some(input_err(e));
                    }
                }
                match last_err {
                    None => Ok(()),
                    Some(e) => Err(e),
                }
            }
        }
    }
}

fn make_enigo() -> Result<Enigo, MediaError> {
    let settings = Settings::default();
    Enigo::new(&settings).map_err(|e| MediaError::Unavailable {
        capability: "input_permission".into(),
        reason: format!("enigo::Enigo::new failed: {e:?}"),
    })
}

fn input_err<E: std::fmt::Display>(e: E) -> MediaError {
    MediaError::Other {
        message: format!("input error: {e}"),
    }
}

fn parse_button(s: &str) -> Button {
    match s.to_lowercase().as_str() {
        "right" | "r" => Button::Right,
        "middle" | "m" => Button::Middle,
        _ => Button::Left,
    }
}

/// 把 `"ctrl+c"` / `"cmd+shift+p"` 字符串解析成组合键并依次按下 / 释放。
fn press_combo(enigo: &mut Enigo, keys: &str) -> Result<(), MediaError> {
    let parts: Vec<&str> = keys
        .split('+')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    if parts.is_empty() {
        return Err(MediaError::Other {
            message: format!("empty combo: {keys:?}"),
        });
    }
    // 按下所有修饰键,最后一个是主键,然后 click 主键,释放所有修饰键(逆序)。
    // 释放必须无条件执行:主键 click 失败时若提前返回,已按下的 Ctrl/Cmd
    // 会卡在 OS 层,影响整个桌面直到用户手动再按一次。
    let parsed: Vec<Key> = parts.iter().map(|p| parse_key(p)).collect();
    let (modifiers, last) = parsed.split_at(parsed.len() - 1);
    let mut press_error = None;
    for k in modifiers {
        if let Err(e) = enigo.key(*k, Direction::Press) {
            press_error = Some(input_err(e));
            break;
        }
    }
    if press_error.is_none() {
        if let Err(e) = enigo.key(last[0], Click) {
            press_error = Some(input_err(e));
        }
    }
    for k in modifiers.iter().rev() {
        let _ = enigo.key(*k, Direction::Release);
    }
    press_error.map_or(Ok(()), Err)
}

fn parse_key(name: &str) -> Key {
    let n = name.to_lowercase();
    match n.as_str() {
        "ctrl" | "control" => Key::Control,
        "shift" => Key::Shift,
        "alt" | "option" => Key::Alt,
        "cmd" | "command" | "meta" | "super" => Key::Meta,
        "enter" | "return" => Key::Return,
        "tab" => Key::Tab,
        "esc" | "escape" => Key::Escape,
        "backspace" => Key::Backspace,
        "space" => Key::Space,
        "left" => Key::LeftArrow,
        "right" => Key::RightArrow,
        "up" => Key::UpArrow,
        "down" => Key::DownArrow,
        other => Key::Unicode(other.chars().next().unwrap_or('?')),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_button_known() {
        assert!(matches!(parse_button("left"), Button::Left));
        assert!(matches!(parse_button("RIGHT"), Button::Right));
        assert!(matches!(parse_button("middle"), Button::Middle));
    }

    #[test]
    fn parse_key_modifiers() {
        assert!(matches!(parse_key("ctrl"), Key::Control));
        assert!(matches!(parse_key("Shift"), Key::Shift));
        assert!(matches!(parse_key("cmd"), Key::Meta));
    }

    #[test]
    fn parse_key_arrows() {
        assert!(matches!(parse_key("left"), Key::LeftArrow));
        assert!(matches!(parse_key("RIGHT"), Key::RightArrow));
    }

    #[test]
    fn real_image_backend_load_metadata_includes_dimensions() {
        // 在内存中创建 4x4 PNG 并写入临时目录。
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.png");
        let img = image::RgbImage::from_fn(4, 4, |_, _| image::Rgb([255, 0, 0]));
        img.save(&path).unwrap();
        let backend = RealImageBackend::new();
        let asset = backend.load_metadata(&path).unwrap();
        assert_eq!(asset.width, Some(4));
        assert_eq!(asset.height, Some(4));
        assert_eq!(asset.mime_type.as_deref(), Some("image/png"));
    }

    #[test]
    fn real_image_backend_process_resize_to_jpeg() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("in.png");
        let output = dir.path().join("out.jpg");
        let img = image::RgbImage::from_fn(8, 8, |_, _| image::Rgb([0, 255, 0]));
        img.save(&input).unwrap();
        let backend = RealImageBackend::new();
        let spec = ImageProcessSpec {
            input_path: input.to_string_lossy().into_owned(),
            output_path: output.to_string_lossy().into_owned(),
            format: Some(ImageFormat::Jpeg),
            width: Some(4),
            height: Some(2),
            quality: None,
        };
        let result = backend.process(&spec).unwrap();
        assert_eq!(result.width, 4);
        assert_eq!(result.height, 2);
        assert_eq!(result.format, ImageFormat::Jpeg);
        assert!(result.bytes > 0);
        // 校验确实生成了 JPEG:读取魔数。
        let mut f = std::fs::File::open(&output).unwrap();
        let mut buf = [0u8; 2];
        use std::io::Read;
        f.read_exact(&mut buf).unwrap();
        assert_eq!(buf, [0xff, 0xd8]); // JPEG SOI 标记。
    }

    #[test]
    fn real_image_backend_process_infers_format_from_output_path() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("in.png");
        let output = dir.path().join("out.png");
        std::fs::write(&input, b"").ok(); // 不在意内容
        // 用真 PNG content 而非空。
        let img = image::RgbImage::from_fn(2, 2, |_, _| image::Rgb([0, 0, 0]));
        img.save(&input).unwrap();
        let backend = RealImageBackend::new();
        let spec = ImageProcessSpec {
            input_path: input.to_string_lossy().into_owned(),
            output_path: output.to_string_lossy().into_owned(),
            format: None,
            width: None,
            height: None,
            quality: None,
        };
        let result = backend.process(&spec).unwrap();
        assert_eq!(result.format, ImageFormat::Png);
    }

    #[test]
    fn real_image_backend_load_metadata_ioerror() {
        let backend = RealImageBackend::new();
        let err = backend
            .load_metadata(Path::new("/nonexistent/path/xyz.png"))
            .unwrap_err();
        assert!(matches!(err, MediaError::IoError { .. }));
    }

    #[test]
    fn real_image_backend_returns_unavailable_capability_full() {
        let backend = RealImageBackend::new();
        assert_eq!(backend.capability(), BackendCapability::Full);
    }

    #[test]
    fn real_computer_backend_full_capability() {
        let backend = RealComputerBackend::new();
        assert_eq!(backend.capability(), BackendCapability::Full);
    }

    #[test]
    fn format_to_mime_roundtrip() {
        assert_eq!(crate_format_to_mime(ImageFormat::Png), "image/png");
        assert_eq!(crate_format_to_mime(ImageFormat::Jpeg), "image/jpeg");
    }
}
