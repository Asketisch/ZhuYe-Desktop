//! Media Studio + Computer Use 抽象层 (Phase 3 条目 13)。
//!
//! 提供无外部依赖的 trait + enum + 元数据扫描：
//!
//! - [`MediaAsset`] / [`ImageProcessSpec`] / [`ImageFormat`] —— 图片元数据与处理
//!   spec 描述；**真实图片处理留作后续**（需要 `image` crate,加到
//!   `src-tauri/Cargo.toml`,不进 核心 crate 镜像）。
//! - [`ComputerUseAction`] —— 抽象层：鼠标 / 键盘 / 截图动作。
//! - [`ImageBackend`] / [`ComputerBackend`] —— trait 抽象,真实实现落 src-tauri
//!   (`xcap` / `enigo` + macOS 权限),与 app-core 解耦。
//!
//! Computer Use 在没有 xcap/enigo 的环境（如 CI / headless）会统一返回
//! [`MediaError::Unavailable`] —— 优雅降级,不 panic。

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// 图片格式枚举。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageFormat {
    /// PNG(无损,支持 alpha)。
    Png,
    /// JPEG(有损)。
    Jpeg,
    /// GIF(无损动画)。
    Gif,
    /// WebP(无损/有损,现代 web)。
    WebP,
    /// BMP(未压缩位图)。
    Bmp,
}

impl ImageFormat {
    /// 用文件扩展名推断格式。
    pub fn from_ext(ext: &str) -> Option<Self> {
        let e = ext.trim_start_matches('.').to_lowercase();
        match e.as_str() {
            "png" => Some(Self::Png),
            "jpg" | "jpeg" => Some(Self::Jpeg),
            "gif" => Some(Self::Gif),
            "webp" => Some(Self::WebP),
            "bmp" => Some(Self::Bmp),
            _ => None,
        }
    }

    /// 文件扩展名字符串(包括点)。
    pub fn ext(self) -> &'static str {
        match self {
            Self::Png => ".png",
            Self::Jpeg => ".jpg",
            Self::Gif => ".gif",
            Self::WebP => ".webp",
            Self::Bmp => ".bmp",
        }
    }
}

/// 单个媒体资产(图片文件元数据)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaAsset {
    /// 绝对路径。
    pub path: PathBuf,
    /// 文件名(含扩展名)。
    pub filename: String,
    /// 字节大小。
    pub size_bytes: u64,
    /// MIME(从扩展名推断,如 `image/png`)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    /// 像素宽(仅图片;由 `image` 后端填充,本 trait 默认 None)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    /// 像素高。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    /// 最后修改时间(毫秒)。
    pub modified_at_ms: u64,
}

/// 图片处理请求。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageProcessSpec {
    /// 源文件路径。
    pub input_path: String,
    /// 输出路径(不存在则创建父目录)。
    pub output_path: String,
    /// 目标格式(推断自 `output_path` 扩展名时为 None)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<ImageFormat>,
    /// 目标宽度(可选;None = 保持原宽)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    /// 目标高度(可选;None = 保持原高)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    /// JPEG 质量(1-100;仅 Jpeg 格式)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quality: Option<u8>,
}

/// 图片处理结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageProcessResult {
    /// 实际输出路径。
    pub output_path: String,
    /// 输出图片宽。
    pub width: u32,
    /// 输出图片高。
    pub height: u32,
    /// 输出格式。
    pub format: ImageFormat,
    /// 输出字节数。
    pub bytes: u64,
}

/// Computer use 动作枚举(纯本地 enum,真实执行由 `ComputerBackend` 完成)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "params")]
pub enum ComputerUseAction {
    /// 截屏(返回 PNG bytes 或保存到文件)。
    Screenshot,
    /// 鼠标移动到 `(x, y)` 屏幕坐标。
    MouseMove {
        /// 屏幕 X 坐标。
        x: i32,
        /// 屏幕 Y 坐标。
        y: i32,
    },
    /// 鼠标点击(默认左键)。
    MouseClick {
        /// 屏幕 X 坐标。
        x: i32,
        /// 屏幕 Y 坐标。
        y: i32,
        /// 按钮:`left`(默认) / `right` / `middle`。
        #[serde(default = "default_button")]
        button: String,
    },
    /// 键盘输入文本。
    KeyType {
        /// 要输入的文本(不支持 unicode 复合字符)。
        text: String,
    },
    /// 组合键(`ctrl+c` / `cmd+v` 之类,用 `+` 连接)。
    KeyCombo {
        /// 组合键字符串,如 `"ctrl+c"` / `"cmd+shift+p"`。
        keys: String,
    },
    /// 滚轮。
    Scroll {
        /// 水平增量(负数 = 向左)。
        dx: i32,
        /// 垂直增量(负数 = 向上)。
        dy: i32,
    },
}

fn default_button() -> String {
    "left".into()
}

impl ComputerUseAction {
    /// 人类可读摘要(给 activity timeline 用)。
    pub fn summary(&self) -> String {
        match self {
            Self::Screenshot => "Screenshot".into(),
            Self::MouseMove { x, y } => format!("Mouse move ({x}, {y})"),
            Self::MouseClick { x, y, button } => format!("{button} click ({x}, {y})"),
            Self::KeyType { text } => format!("Type \"{}\"", truncate(text, 20)),
            Self::KeyCombo { keys } => format!("Combo {keys}"),
            Self::Scroll { dx, dy } => format!("Scroll ({dx}, {dy})"),
        }
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max).collect();
        out.push('…');
        out
    }
}

/// 后端能力(是否支持截图/输入)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BackendCapability {
    /// 完整可执行(已绑定 native backend)。
    Full,
    /// 仅元数据(只能读 Asset,不能处理/截图)。
    MetadataOnly,
    /// 不可用(CI / headless / 缺权限)。
    Unavailable,
}

/// 图片后端 trait(`src-tauri` 提供 `image`-backed 实现,本模块默认 None)。
pub trait ImageBackend: Send + Sync {
    /// 当前能力。
    fn capability(&self) -> BackendCapability;
    /// 读图片元数据(自动实现:仅读文件头,不依赖 image)。
    fn load_metadata(&self, path: &Path) -> Result<MediaAsset, MediaError>;
    /// 处理图片(裁剪 / 缩放 / 格式转换)。
    fn process(&self, spec: &ImageProcessSpec) -> Result<ImageProcessResult, MediaError>;
}

/// Computer use 后端 trait(`src-tauri` 提供 `xcap` + `enigo` 实现)。
pub trait ComputerBackend: Send + Sync {
    /// 当前能力。
    fn capability(&self) -> BackendCapability;
    /// 截图:返回 PNG bytes(若有 capability == Full)。
    fn screenshot(&self) -> Result<Vec<u8>, MediaError>;
    /// 执行一个动作(必须有 capability == Full)。
    fn execute(&self, action: &ComputerUseAction) -> Result<(), MediaError>;
}

/// Media 错误。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaError {
    /// 后端不可用(headless / 权限缺失 / 缺 platform deps)。
    Unavailable {
        /// 缺失能力名:如 `"screenshot"` / `"mouse_input"` / `"image_decode"`。
        capability: String,
        /// 原因(诊断)。
        reason: String,
    },
    /// 路径不存在 / 不是文件。
    NotFound {
        /// 错误消息。
        message: String,
    },
    /// I/O 错误。
    IoError {
        /// 错误消息。
        message: String,
    },
    /// 不支持的文件格式。
    UnsupportedFormat {
        /// 错误消息。
        message: String,
    },
    /// 其他错误。
    Other {
        /// 错误消息。
        message: String,
    },
}

impl std::fmt::Display for MediaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MediaError::Unavailable { capability, reason } => {
                write!(f, "media unavailable ({capability}): {reason}")
            }
            MediaError::NotFound { message } => write!(f, "media not found: {message}"),
            MediaError::IoError { message } => write!(f, "media io error: {message}"),
            MediaError::UnsupportedFormat { message } => {
                write!(f, "unsupported format: {message}")
            }
            MediaError::Other { message } => write!(f, "media error: {message}"),
        }
    }
}

impl std::error::Error for MediaError {}

/// 扫描目录返回 asset 元数据列表（浅扫描，仅根目录，不递归）。
///
/// 使用标准库 `std::fs`，无外部依赖。要求 `path` 为真实目录。
pub fn scan_dir_for_assets(dir: &Path) -> Result<Vec<MediaAsset>, MediaError> {
    if !dir.is_dir() {
        return Err(MediaError::NotFound {
            message: format!("not a directory: {}", dir.display()),
        });
    }
    let entries = std::fs::read_dir(dir).map_err(|e| MediaError::IoError {
        message: e.to_string(),
    })?;
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let filename = match path.file_name().and_then(|n| n.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        // 只看图片扩展名。
        let ext = match path.extension().and_then(|e| e.to_str()) {
            Some(e) => e,
            None => continue,
        };
        if ImageFormat::from_ext(ext).is_none() {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let modified_at_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_millis() as u64);
        let mime = mime_from_format(ImageFormat::from_ext(ext).unwrap());
        out.push(MediaAsset {
            path,
            filename,
            size_bytes: meta.len(),
            mime_type: Some(mime),
            width: None,
            height: None,
            modified_at_ms,
        });
    }
    // 按修改时间倒序(最新在前)。
    out.sort_by_key(|a| std::cmp::Reverse(a.modified_at_ms));
    Ok(out)
}

fn mime_from_format(f: ImageFormat) -> String {
    match f {
        ImageFormat::Png => "image/png".into(),
        ImageFormat::Jpeg => "image/jpeg".into(),
        ImageFormat::Gif => "image/gif".into(),
        ImageFormat::WebP => "image/webp".into(),
        ImageFormat::Bmp => "image/bmp".into(),
    }
}

/// 一个不需要外部 crate 的 "metadata-only" backend,把图片维度信息留 None。
pub struct MetadataOnlyBackend;

impl MetadataOnlyBackend {
    /// 构造 metadata-only backend(读取文件元数据,不做图像解码)。
    pub fn new() -> Self {
        Self
    }
}

impl Default for MetadataOnlyBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl ImageBackend for MetadataOnlyBackend {
    fn capability(&self) -> BackendCapability {
        BackendCapability::MetadataOnly
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
        let mime = format.map(mime_from_format);
        let modified_at_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_millis() as u64);
        Ok(MediaAsset {
            path: path.to_path_buf(),
            filename,
            size_bytes: meta.len(),
            mime_type: mime,
            width: None,
            height: None,
            modified_at_ms,
        })
    }
    fn process(&self, _spec: &ImageProcessSpec) -> Result<ImageProcessResult, MediaError> {
        Err(MediaError::Unavailable {
            capability: "image_decode".into(),
            reason: "metadata-only backend: bind a real image crate to enable processing".into(),
        })
    }
}

/// "不可用"的电脑操控后端（无头环境 / 无原生绑定）。
pub struct UnavailableComputerBackend;

impl UnavailableComputerBackend {
    /// 构造 unavailable backend(headless / 缺 native 依赖时用)。
    pub fn new() -> Self {
        Self
    }
}

impl Default for UnavailableComputerBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl ComputerBackend for UnavailableComputerBackend {
    fn capability(&self) -> BackendCapability {
        BackendCapability::Unavailable
    }
    fn screenshot(&self) -> Result<Vec<u8>, MediaError> {
        Err(MediaError::Unavailable {
            capability: "screenshot".into(),
            reason: "no xcap / native screen capture bound (CI / headless?)".into(),
        })
    }
    fn execute(&self, _action: &ComputerUseAction) -> Result<(), MediaError> {
        Err(MediaError::Unavailable {
            capability: "mouse_input".into(),
            reason: "no enigo / native input simulation bound".into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn image_format_from_ext() {
        assert_eq!(ImageFormat::from_ext("png"), Some(ImageFormat::Png));
        assert_eq!(ImageFormat::from_ext("PNG"), Some(ImageFormat::Png));
        assert_eq!(ImageFormat::from_ext("jpg"), Some(ImageFormat::Jpeg));
        assert_eq!(ImageFormat::from_ext("jpeg"), Some(ImageFormat::Jpeg));
        assert_eq!(ImageFormat::from_ext("webp"), Some(ImageFormat::WebP));
        assert_eq!(ImageFormat::from_ext("xyz"), None);
        assert_eq!(ImageFormat::from_ext(""), None);
    }

    #[test]
    fn image_format_ext_roundtrip() {
        assert_eq!(ImageFormat::Png.ext(), ".png");
        assert_eq!(ImageFormat::Jpeg.ext(), ".jpg");
    }

    #[test]
    fn media_asset_serialization() {
        let a = MediaAsset {
            path: PathBuf::from("/tmp/x.png"),
            filename: "x.png".into(),
            size_bytes: 100,
            mime_type: Some("image/png".into()),
            width: Some(100),
            height: Some(200),
            modified_at_ms: 1700000000000,
        };
        let v = serde_json::to_value(&a).unwrap();
        assert_eq!(v["filename"], "x.png");
        assert_eq!(v["mimeType"], "image/png");
        assert_eq!(v["width"], 100);
    }

    #[test]
    fn computer_use_action_serializes_tagged() {
        let action = ComputerUseAction::MouseClick {
            x: 10,
            y: 20,
            button: "left".into(),
        };
        let v = serde_json::to_value(&action).unwrap();
        assert_eq!(v["kind"], "mouseClick");
        assert_eq!(v["params"]["x"], 10);
    }

    #[test]
    fn computer_use_action_summary() {
        let s = ComputerUseAction::MouseMove { x: 1, y: 2 }.summary();
        assert!(s.contains("Mouse"));
        let s2 = ComputerUseAction::KeyCombo {
            keys: "ctrl+c".into(),
        }
        .summary();
        assert!(s2.contains("ctrl+c"));
    }

    #[test]
    fn media_error_display() {
        let e = MediaError::Unavailable {
            capability: "screenshot".into(),
            reason: "no display".into(),
        };
        assert!(e.to_string().contains("screenshot"));
        let e2 = MediaError::NotFound {
            message: "x".into(),
        };
        assert!(e2.to_string().contains("x"));
    }

    #[test]
    fn metadata_only_backend_loads_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("test.png");
        std::fs::write(&p, b"\x89PNG\r\n\x1a\n").unwrap();
        let backend = MetadataOnlyBackend::new();
        let asset = backend.load_metadata(&p).unwrap();
        assert_eq!(asset.filename, "test.png");
        assert_eq!(asset.mime_type.as_deref(), Some("image/png"));
        assert_eq!(asset.size_bytes, 8);
    }

    #[test]
    fn metadata_only_backend_process_unavailable() {
        let backend = MetadataOnlyBackend::new();
        let spec = ImageProcessSpec {
            input_path: "/tmp/in.png".into(),
            output_path: "/tmp/out.png".into(),
            format: None,
            width: None,
            height: None,
            quality: None,
        };
        let err = backend.process(&spec).unwrap_err();
        assert!(matches!(err, MediaError::Unavailable { .. }));
    }

    #[test]
    fn unavailable_computer_backend_returns_unavailable() {
        let backend = UnavailableComputerBackend::new();
        assert!(
            backend
                .screenshot()
                .unwrap_err()
                .to_string()
                .contains("screenshot")
        );
        let act = ComputerUseAction::Screenshot;
        assert!(backend.execute(&act).is_err());
    }

    #[test]
    fn scan_dir_returns_only_images() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.png"), b"x").unwrap();
        std::fs::write(dir.path().join("b.jpg"), b"y").unwrap();
        std::fs::write(dir.path().join("c.txt"), b"z").unwrap();
        let assets = scan_dir_for_assets(dir.path()).unwrap();
        // 排序按 mtime:可能相同,排序需稳定 → 检查 set 大小与种类。
        let by_name: HashMap<_, _> = assets.iter().map(|a| (a.filename.clone(), a)).collect();
        assert_eq!(assets.len(), 2);
        assert!(by_name.contains_key("a.png"));
        assert!(by_name.contains_key("b.jpg"));
        assert!(!by_name.contains_key("c.txt"));
    }

    #[test]
    fn scan_dir_nonexistent_returns_not_found() {
        let err = scan_dir_for_assets(Path::new("/nonexistent/dir/xyz")).unwrap_err();
        assert!(matches!(err, MediaError::NotFound { .. }));
    }

    #[test]
    fn truncate_helper() {
        assert_eq!(truncate("hello", 10), "hello");
        assert_eq!(truncate("hello world", 5), "hello…");
    }
}
