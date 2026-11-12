//! Media Studio + Computer Use 命令面。
//!
//! 现在用 **真实 backend** (`image` crate + `xcap` + `enigo`),
//! 由 `media_backend::{RealImageBackend, RealComputerBackend}` 提供。

use reflect_app_core::media::{
    BackendCapability, ComputerBackend, ComputerUseAction, ImageBackend, ImageProcessResult,
    ImageProcessSpec, MediaAsset, MediaError, scan_dir_for_assets,
};
use tauri::State;

use super::CommandResult;
use crate::media_backend::{RealComputerBackend, RealImageBackend};
use crate::state::MinimalAgent;

impl From<MediaError> for super::error::CommandError {
    fn from(e: MediaError) -> Self {
        super::error::CommandError { msg: e.to_string() }
    }
}

/// 列出目录下的图片资产(浅扫描,仅根目录)。
#[tauri::command]
pub async fn reflect_list_media(dir: String) -> CommandResult<Vec<MediaAsset>> {
    Ok(scan_dir_for_assets(std::path::Path::new(&dir))?)
}

/// 处理图片(裁剪 / 缩放 / 格式转换)。
///
/// 用 `RealImageBackend`(`image` crate):完整 png/jpeg/gif/webp/bmp 处理。
#[tauri::command]
pub async fn reflect_image_process(spec: ImageProcessSpec) -> CommandResult<ImageProcessResult> {
    let backend = RealImageBackend::new();
    Ok(backend.process(&spec)?)
}

/// 截屏(返回 base64-encoded PNG bytes)。
///
/// 用 `RealComputerBackend` + xcap:失败(权限/无显示)返回
/// `MediaError::Unavailable`。
#[tauri::command]
pub async fn reflect_screenshot(_agent: State<'_, MinimalAgent>) -> CommandResult<String> {
    let backend = RealComputerBackend::new();
    screenshot_base64_with(&backend)
}

/// 截图命令的可测核心:注入 backend 以便单元测试覆盖 base64 编码与错误映射,
/// 生产路径始终传真实 `RealComputerBackend`。
pub(crate) fn screenshot_base64_with(backend: &dyn ComputerBackend) -> CommandResult<String> {
    let bytes = backend.screenshot()?;
    Ok(base64_encode(&bytes))
}

/// 执行一个 computer-use 动作(鼠标 / 键盘)。
///
/// 用 `RealComputerBackend` + enigo:截屏以外的 6 种动作都路由到
/// `Enigo::button / move_mouse / text / key / scroll`。
#[tauri::command]
pub async fn reflect_computer_use(action: ComputerUseAction) -> CommandResult<()> {
    let backend = RealComputerBackend::new();
    backend.execute(&action)?;
    Ok(())
}

/// 媒体能力描述(诊断用)。
#[tauri::command]
pub async fn reflect_media_capabilities() -> CommandResult<MediaCapabilities> {
    let image_backend: BackendCapability = RealImageBackend::new().capability();
    let computer_backend: BackendCapability = RealComputerBackend::new().capability();
    Ok(MediaCapabilities {
        image_backend: format!("{image_backend:?}").to_lowercase(),
        computer_backend: format!("{computer_backend:?}").to_lowercase(),
        note: match (image_backend, computer_backend) {
            (BackendCapability::Full, BackendCapability::Full) => {
                "image + xcap + enigo backends are live.".into()
            }
            (BackendCapability::Full, _) => {
                "image backend live; computer backend unavailable (permission?)".into()
            }
            _ => "backends unavailable in this environment".into(),
        },
    })
}

/// 能力描述摘要。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaCapabilities {
    /// 当前 image backend 名。
    pub image_backend: String,
    /// 当前 computer backend 名。
    pub computer_backend: String,
    /// 备注说明。
    pub note: String,
}

pub(crate) fn base64_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        let triple = ((b0 as u32) << 16) | ((b1 as u32) << 8) | (b2 as u32);
        let idx0 = ((triple >> 18) & 0x3F) as usize;
        let idx1 = ((triple >> 12) & 0x3F) as usize;
        let idx2 = ((triple >> 6) & 0x3F) as usize;
        let idx3 = (triple & 0x3F) as usize;
        out.push(ALPHABET[idx0] as char);
        out.push(ALPHABET[idx1] as char);
        if chunk.len() > 1 {
            out.push(ALPHABET[idx2] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(ALPHABET[idx3] as char);
        } else {
            out.push('=');
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const TESTED_COMMANDS: &[&str] = &["reflect_screenshot"];

    struct FakeComputerBackend {
        result: Result<Vec<u8>, MediaError>,
    }

    impl ComputerBackend for FakeComputerBackend {
        fn capability(&self) -> BackendCapability {
            BackendCapability::Full
        }

        fn screenshot(&self) -> Result<Vec<u8>, MediaError> {
            self.result.clone()
        }

        fn execute(&self, _action: &ComputerUseAction) -> Result<(), MediaError> {
            Ok(())
        }
    }

    #[test]
    fn screenshot_command_encodes_backend_bytes_as_base64() {
        assert_eq!(TESTED_COMMANDS, &["reflect_screenshot"]);
        let backend = FakeComputerBackend {
            result: Ok(vec![0x89, b'P', b'N', b'G']),
        };
        let encoded = screenshot_base64_with(&backend).expect("截图编码失败");
        assert_eq!(encoded, "iVBORw==");
    }

    #[test]
    fn screenshot_command_maps_backend_unavailable_error() {
        let backend = FakeComputerBackend {
            result: Err(MediaError::Unavailable {
                capability: "screenshot".into(),
                reason: "no monitors detected".into(),
            }),
        };
        let error = screenshot_base64_with(&backend).expect_err("应返回结构化错误");
        assert!(
            error.msg.contains("media unavailable") && error.msg.contains("no monitors"),
            "错误应保留后端诊断:{}",
            error.msg
        );
    }
}
