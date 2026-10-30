//! macOS dock badge —— 烛夜桌面端（ZhuYe）特有。
//!
//! 通过 `objc2-app-kit` 直接调 `NSApplication.dockTile.badgeLabel`。
//! 用法:
//! - `None` → 清空 badge;
//! - `Some("3")` → 显示数字 badge "3";
//! - `Some("●")` → 显示红点 (Unicode)。
//!
//! 非 macOS 平台 = no-op stub。stub 平台下本文件的 macOS 实现与入口
//! 自然 dead —— 平台 stub 语义,抑制 dead_code(CI ubuntu 实测)。
//!
//! ## 主线程约束
//!
//! `NSApplication::sharedApplication()` 要求在 main thread 调用。
//! 我们用 Tauri 的 `app.run_on_main_thread()` 切到主线程,这样
//! `reflect_set_dock_badge` command 在任意线程 invoke 都安全。

#![allow(dead_code)]

use tauri::{AppHandle, Runtime};

/// macOS 主线程入口 —— 通过 `app.run_on_main_thread` 在主线程执行。
///
/// 其他平台为 no-op stub。
#[cfg(target_os = "macos")]
fn set_dock_badge_impl(label: Option<String>) {
    use objc2::rc::autoreleasepool;
    use objc2_app_kit::NSDockTile;
    use objc2_foundation::{MainThreadMarker, NSString};

    autoreleasepool(|_| {
        // SAFETY: 由 Tauri `app.run_on_main_thread` 切到主线程,
        // 这里 mtm 是有效的 main thread marker。
        let mtm = unsafe { MainThreadMarker::new_unchecked() };

        // NSApplication::sharedApplication 必须在 main thread;
        // 这里我们直接构造 NSDockTile via class alloc + init。
        // 实际上 dock badge 用 NSApp.dockTile().setBadgeLabel 取得 dock tile。
        //
        // 简化方案:用 NSApp 全局 application 拿 dock tile。
        use objc2::msg_send_id;
        use objc2::runtime::AnyObject;
        let app_cls = objc2::class!(NSApplication);
        // SAFETY: `+sharedApplication` 是仅主线程可用的类方法。
        let app: Option<objc2::rc::Retained<AnyObject>> =
            unsafe { msg_send_id![app_cls, sharedApplication] };
        if let Some(app) = app {
            // dockTile
            let dock_tile: Option<objc2::rc::Retained<NSDockTile>> =
                unsafe { msg_send_id![&app, dockTile] };
            if let Some(tile) = dock_tile {
                let ns_label = label.as_deref().map(NSString::from_str);
                // SAFETY: setBadgeLabel 接受 Option<&NSString>,传入 None 清空。
                unsafe { tile.setBadgeLabel(ns_label.as_deref()) };
            }
        }
        // mtm 占位(未来可能用)
        let _ = mtm;
    });
}

/// 非 macOS 占位 —— 函数存在,签名一致,避免 `lib.rs` 用 `cfg` 分支。
#[cfg(not(target_os = "macos"))]
fn set_dock_badge_impl(_label: Option<String>) {}

/// 设置 dock badge,跨 main thread 安全。
///
/// macOS:派发到 main thread 后调 `NSApplication.dockTile().setBadgeLabel(...)`。
/// 其他平台:no-op。
pub fn set_dock_badge<R: Runtime>(app: &AppHandle<R>, label: Option<String>) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.run_on_main_thread(move || {
            set_dock_badge_impl(label);
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        let _ = label;
    }
}

// Tauri command `reflect_set_dock_badge` 已按领域约定移至
// `src-tauri/src/commands/dock.rs`(薄包装,调用本模块的
// [`set_dock_badge`]);lib.rs 经 `commands` 重导出注册。
