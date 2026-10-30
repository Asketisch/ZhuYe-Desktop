//! 全局快捷键 (烛夜桌面端 ZhuYe 特有)。
//!
//! 用 `tauri-plugin-global-shortcut` 注册应用前台+后台均可触发的快捷键。
//! 默认注册一项:Cmd+Shift+Space (macOS) / Ctrl+Shift+Space (其他) 切换主窗口
//! show/hide,作为快速唤起 GUI 的入口。
//!
//! M3.x 阶段:把 toggle 快捷键做成 settings 可配置。

use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// 注册所有全局快捷键。在 Tauri setup 阶段调用一次。
pub fn register_global_shortcuts<R: Runtime>(app: &AppHandle<R>) -> anyhow::Result<()> {
    let gs = app.global_shortcut();
    // macOS → Cmd（SUPER），Linux/Windows → Ctrl。
    #[cfg(target_os = "macos")]
    let modifiers = Modifiers::SUPER | Modifiers::SHIFT;
    #[cfg(not(target_os = "macos"))]
    let modifiers = Modifiers::CONTROL | Modifiers::SHIFT;
    let toggle = Shortcut::new(Some(modifiers), Code::Space);

    gs.on_shortcut(toggle, move |app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            toggle_main_window(app);
        }
    })?;

    #[cfg(target_os = "macos")]
    let label = "Cmd+Shift+Space";
    #[cfg(not(target_os = "macos"))]
    let label = "Ctrl+Shift+Space";
    tracing::info!("[reflect-gui] global shortcut registered: {label} (toggle main window)");
    Ok(())
}

/// 切换主窗口 show/hide —— 立即可见时 hide,不可见时 show+focus。
fn toggle_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        match window.is_visible() {
            Ok(true) => {
                let _ = window.hide();
            }
            _ => {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
    }
}
