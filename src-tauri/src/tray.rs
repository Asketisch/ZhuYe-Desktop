//! 系统托盘图标 (macOS-only)。
//!
//! 托盘结构：
//! - 左键单击 = 直接弹菜单 (`show_menu_on_left_click(true)`);
//! - 菜单项 = Show / Hide / Quit,click 后由 `handle_tray_menu_event` 派发;
//! - 图标作为 macOS template image 自动着色 (`icon_as_template(true)`)。
//!
//! 复用 `src-tauri/icons/icon32.png` 作为托盘图标 (已是 RGBA PNG)。
//!
//! 非 macOS 平台:托盘仅在 macOS 激活,Linux/Windows 下本文件的辅助
//! 函数与导入自然 dead —— 平台 stub 语义,抑制 dead_code/unused_imports
//! (CI ubuntu 实测)。

#![allow(dead_code, unused_imports)]

#[allow(unused_imports)]
use tauri::tray::TrayIcon;
use tauri::{
    AppHandle, Manager, Runtime,
    image::Image,
    menu::{Menu, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

/// 托盘 ID —— 单一托盘实例。
pub const TRAY_ID: &str = "reflect-tray";

/// 菜单项 ID 常量。
pub const TRAY_SHOW: &str = "tray_show";
pub const TRAY_HIDE: &str = "tray_hide";
pub const TRAY_NEW_AGENT: &str = "tray_new_agent";
pub const TRAY_QUIT: &str = "tray_quit";

/// 构建并注册 macOS 系统托盘。
///
/// 仅 macOS 平台编译；其他平台此函数为 stub。
#[cfg(target_os = "macos")]
pub fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = build_tray_menu(app)?;
    TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("烛夜 ZhuYe")
        .show_menu_on_left_click(true)
        .icon(load_tray_icon()?)
        .icon_as_template(true)
        .on_menu_event(handle_tray_menu_event::<R>)
        .on_tray_icon_event(handle_tray_icon_event::<R>)
        .build(app)?;
    tracing::info!("[reflect-gui] tray initialized");
    Ok(())
}

/// 非 macOS 平台 —— tray 模块整体为 no-op。`lib.rs` 仍调用此函数,不报错。
#[cfg(not(target_os = "macos"))]
pub fn build_tray<R: Runtime>(_app: &AppHandle<R>) -> tauri::Result<()> {
    tracing::debug!("[reflect-gui] tray: skipped (non-macOS platform)");
    Ok(())
}

/// 构建托盘菜单 (Show / New Agent / Hide / --- / Quit)。
fn build_tray_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let show = MenuItemBuilder::with_id(TRAY_SHOW, "Show Window").build(app)?;
    let new_agent = MenuItemBuilder::with_id(TRAY_NEW_AGENT, "New Agent").build(app)?;
    let hide = MenuItemBuilder::with_id(TRAY_HIDE, "Hide Window").build(app)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id(TRAY_QUIT, "Quit Reflect").build(app)?;
    Menu::with_items(app, &[&show, &new_agent, &hide, &separator, &quit])
}

/// 加载托盘图标 (RGBA PNG, 32x32)。`include_bytes!` 在编译期嵌入。
fn load_tray_icon() -> tauri::Result<Image<'static>> {
    Image::from_bytes(include_bytes!("../icons/icon32.png"))
        .map_err(|e| tauri::Error::AssetNotFound(format!("tray icon: {e}")))
}

/// 托盘菜单 click 派发 —— `on_menu_event` 回调。
fn handle_tray_menu_event<R: Runtime>(app: &AppHandle<R>, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        TRAY_SHOW => show_main_window(app),
        TRAY_NEW_AGENT => {
            show_main_window(app);
            let _ = tauri::Emitter::emit(app, "tray-new-agent", ());
        }
        TRAY_HIDE => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.hide();
            }
        }
        TRAY_QUIT => app.exit(0),
        _ => {}
    }
}

/// 托盘图标 click 事件 (备用)。当前用 `show_menu_on_left_click(true)` 接管左键,
/// 此函数只在其他鼠标按钮 (middle/right) 时进入。
fn handle_tray_icon_event<R: Runtime>(_tray: &TrayIcon<R>, event: TrayIconEvent) {
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
    {
        // show_menu_on_left_click=true 时这里不会触发,保留作 fallback。
    }
}

/// 弹出并聚焦主窗口。
pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
