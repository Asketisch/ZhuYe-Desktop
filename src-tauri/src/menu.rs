//! 应用菜单 (macOS 顶栏 / Windows 菜单栏 / Linux app menu)。
//!
//! 菜单结构：
//! - `enable_macos_default_menu(false)` 关闭 Tauri 默认菜单;
//! - 5 个 submenu: Reflect / Edit / Composer / View / Window;
//! - 每个菜单项 click → `app.emit("menu-<id>", ())` 通知前端,
//!   前端 reducer 按 id 决定后续动作 (cycle model / open settings / ...)。
//! - 4 个 inline accelerator: cycle_model / cycle_reasoning / new_agent / interrupt
//!   (M1.x → M3.x 阶段再做 13 个剩余的 settings 化快捷键)。

use tauri::{
    AppHandle, Emitter, Manager, Runtime, WindowEvent,
    menu::{Menu, MenuItemBuilder, PredefinedMenuItem, Submenu},
};

// ====== Reflect (App) 菜单 ======
pub const MENU_ABOUT: &str = "menu_about";
pub const MENU_CHECK_UPDATES: &str = "menu_check_updates";
pub const MENU_SETTINGS: &str = "menu_settings";
pub const MENU_QUIT: &str = "menu_quit";

// ====== Edit 菜单（PredefinedMenuItem）======
// Edit 菜单全部走 PredefinedMenuItem, 不需要自定义 id.

// ====== Composer 菜单 ======
pub const MENU_CYCLE_MODEL: &str = "menu_cycle_model";
pub const MENU_CYCLE_REASONING: &str = "menu_cycle_reasoning";
pub const MENU_NEW_AGENT: &str = "menu_new_agent";
pub const MENU_INTERRUPT: &str = "menu_interrupt";

// ====== View 菜单 ======
pub const MENU_TOGGLE_SIDEBAR: &str = "menu_toggle_sidebar";
pub const MENU_TOGGLE_TERMINAL: &str = "menu_toggle_terminal";

// ====== Window 菜单 ======
pub const MENU_ZOOM: &str = "menu_zoom";
// 注:Window 菜单的 Minimize 走 PredefinedMenuItem(系统内建行为,
// 无自定义 id / 事件分支),故没有 MENU_MINIMIZE 常量。

/// 全部**自定义**菜单项 id(与 `build_*` 里的 `MenuItemBuilder::with_id`
/// 一一对应;PredefinedMenuItem 不算)。`handle_menu_event` 必须对其中
/// 每一项都有分支 —— 单测据此做两侧互校(见本文件 `mod tests`)。
pub const CUSTOM_MENU_IDS: &[&str] = &[
    MENU_ABOUT,
    MENU_CHECK_UPDATES,
    MENU_SETTINGS,
    MENU_QUIT,
    MENU_CYCLE_MODEL,
    MENU_CYCLE_REASONING,
    MENU_NEW_AGENT,
    MENU_INTERRUPT,
    MENU_TOGGLE_SIDEBAR,
    MENU_TOGGLE_TERMINAL,
    MENU_ZOOM,
];

/// 构建完整应用菜单。
pub fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let reflect = build_reflect_menu(app)?;
    let edit = build_edit_menu(app)?;
    let composer = build_composer_menu(app)?;
    let view = build_view_menu(app)?;
    let window = build_window_menu(app)?;
    Menu::with_items(app, &[&reflect, &edit, &composer, &view, &window])
}

fn build_reflect_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    let app_name = "Reflect";
    let about = MenuItemBuilder::with_id(MENU_ABOUT, format!("About {app_name}")).build(app)?;
    let check = MenuItemBuilder::with_id(MENU_CHECK_UPDATES, "Check for Updates…").build(app)?;
    let settings = MenuItemBuilder::with_id(MENU_SETTINGS, "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let hide = PredefinedMenuItem::hide(app, Some(app_name))?;
    let hide_others = PredefinedMenuItem::hide_others(app, None)?;
    let show_all = PredefinedMenuItem::show_all(app, None)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = PredefinedMenuItem::quit(app, None)?;
    Submenu::with_items(
        app,
        app_name,
        true,
        &[
            &about,
            &check,
            &settings,
            &sep,
            &hide,
            &hide_others,
            &show_all,
            &sep2,
            &quit,
        ],
    )
}

fn build_edit_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    let undo = PredefinedMenuItem::undo(app, None)?;
    let redo = PredefinedMenuItem::redo(app, None)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let cut = PredefinedMenuItem::cut(app, None)?;
    let copy = PredefinedMenuItem::copy(app, None)?;
    let paste = PredefinedMenuItem::paste(app, None)?;
    let select_all = PredefinedMenuItem::select_all(app, None)?;
    Submenu::with_items(
        app,
        "Edit",
        true,
        &[&undo, &redo, &sep, &cut, &copy, &paste, &select_all],
    )
}

fn build_composer_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    let cycle_model = MenuItemBuilder::with_id(MENU_CYCLE_MODEL, "Cycle Model")
        .accelerator("CmdOrCtrl+Shift+M")
        .build(app)?;
    let cycle_reasoning = MenuItemBuilder::with_id(MENU_CYCLE_REASONING, "Cycle Reasoning Effort")
        .accelerator("CmdOrCtrl+Shift+R")
        .build(app)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let new_agent = MenuItemBuilder::with_id(MENU_NEW_AGENT, "New Agent")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let interrupt = MenuItemBuilder::with_id(MENU_INTERRUPT, "Interrupt")
        .accelerator("CmdOrCtrl+Shift+I")
        .build(app)?;
    Submenu::with_items(
        app,
        "Composer",
        true,
        &[&cycle_model, &cycle_reasoning, &sep, &new_agent, &interrupt],
    )
}

fn build_view_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    let toggle_sidebar = MenuItemBuilder::with_id(MENU_TOGGLE_SIDEBAR, "Toggle Sidebar")
        .accelerator("CmdOrCtrl+B")
        .build(app)?;
    let toggle_terminal = MenuItemBuilder::with_id(MENU_TOGGLE_TERMINAL, "Toggle Terminal")
        .accelerator("CmdOrCtrl+`")
        .build(app)?;
    Submenu::with_items(app, "View", true, &[&toggle_sidebar, &toggle_terminal])
}

fn build_window_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    let minimize = PredefinedMenuItem::minimize(app, None)?;
    let zoom = MenuItemBuilder::with_id(MENU_ZOOM, "Zoom").build(app)?;
    let close = PredefinedMenuItem::close_window(app, None)?;
    Submenu::with_items(app, "Window", true, &[&minimize, &zoom, &close])
}

/// 菜单 click 派发 —— Tauri builder `.on_menu_event(handle_menu_event)` 调用。
pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref();
    match id {
        MENU_ABOUT => {
            // 弹出主窗口并 emit about 事件,前端决定如何展示 (modal / new window)。
            show_main_window(app);
            let _ = app.emit("menu-about", ());
        }
        MENU_CHECK_UPDATES => {
            show_main_window(app);
            let _ = app.emit("menu-check-updates", ());
        }
        MENU_SETTINGS => {
            show_main_window(app);
            let _ = app.emit("menu-settings", ());
        }
        MENU_CYCLE_MODEL => {
            let _ = app.emit("menu-cycle-model", ());
        }
        MENU_CYCLE_REASONING => {
            let _ = app.emit("menu-cycle-reasoning", ());
        }
        MENU_NEW_AGENT => {
            let _ = app.emit("menu-new-agent", ());
        }
        MENU_INTERRUPT => {
            let _ = app.emit("menu-interrupt", ());
        }
        MENU_TOGGLE_SIDEBAR => {
            let _ = app.emit("menu-toggle-sidebar", ());
        }
        MENU_TOGGLE_TERMINAL => {
            let _ = app.emit("menu-toggle-terminal", ());
        }
        MENU_ZOOM => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.maximize();
            }
        }
        MENU_QUIT => {
            app.exit(0);
        }
        _ => {
            tracing::debug!("[reflect-gui] menu: unhandled id={id}");
        }
    }
}

/// 弹出并聚焦主窗口 (tray.rs 与 menu.rs 共用)。
fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// macOS close-to-tray:拦截 CloseRequested,隐藏而不是退出。
///
/// 只有 macOS 关闭按钮触发 hide;Windows / Linux 行为保持默认 (直接退出)。
/// 由 `lib.rs` 的 `.on_window_event(...)` 闭包调用。
pub fn handle_close_to_tray<R: Runtime>(window: &tauri::Window<R>, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }
    #[cfg(target_os = "macos")]
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window; // silence unused
        let _ = event;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    use tauri::Listener;
    use tauri::menu::MenuId;
    use tauri::test::{mock_builder, mock_context, noop_assets};

    /// 不发前端事件、而走窗口/应用动作的 id(有 match 分支,但无 emit)。
    const NON_EMITTING_IDS: &[&str] = &[MENU_QUIT, MENU_ZOOM];

    /// 自定义 id → 期望发出的前端事件名(menu.rs 的接线约定:
    /// 菜单点击 → `app.emit("menu-<kebab>")` → 前端 reducer)。
    fn expected_event(id: &str) -> Option<&'static str> {
        Some(match id {
            MENU_ABOUT => "menu-about",
            MENU_CHECK_UPDATES => "menu-check-updates",
            MENU_SETTINGS => "menu-settings",
            MENU_CYCLE_MODEL => "menu-cycle-model",
            MENU_CYCLE_REASONING => "menu-cycle-reasoning",
            MENU_NEW_AGENT => "menu-new-agent",
            MENU_INTERRUPT => "menu-interrupt",
            MENU_TOGGLE_SIDEBAR => "menu-toggle-sidebar",
            MENU_TOGGLE_TERMINAL => "menu-toggle-terminal",
            _ => return None,
        })
    }

    #[test]
    fn every_custom_menu_id_is_either_emitting_or_a_registered_action() {
        // muda 的菜单构建绑定主线程(lib 测试线程建不了菜单,macOS 实测
        // `MenuChild can only be created on the main thread`),所以「构建出的
        // 菜单 ↔ 常量表」的互校走不了运行时;退而锁死等价不变量:
        // CUSTOM_MENU_IDS 里的每个 id 要么有事件映射(expected_event),
        // 要么显式登记为窗口动作 —— 新增菜单项忘了接分支(只进常量表)
        // 会在此立刻暴露,而不是运行期落进 `_ => debug!` 的静默兜底。
        let mut unaccounted = Vec::new();
        for id in CUSTOM_MENU_IDS {
            if expected_event(id).is_none() && !NON_EMITTING_IDS.contains(id) {
                unaccounted.push(*id);
            }
        }
        assert!(
            unaccounted.is_empty(),
            "以下菜单常量既没有事件分支也没有登记为窗口动作(死常量或漏接线): {unaccounted:?}"
        );
    }

    #[test]
    fn every_emitting_menu_id_fires_its_frontend_event() {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock app");

        let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        for id in CUSTOM_MENU_IDS {
            if let Some(event_name) = expected_event(id) {
                let sink = seen.clone();
                let name = event_name.to_string();
                app.listen(event_name, move |_event| {
                    sink.lock().unwrap().push(name.clone());
                });
            }
        }

        for id in CUSTOM_MENU_IDS {
            let Some(want) = expected_event(id) else {
                continue;
            };
            seen.lock().unwrap().clear();
            handle_menu_event(
                app.handle(),
                tauri::menu::MenuEvent {
                    id: MenuId::new(*id),
                },
            );
            let got = seen.lock().unwrap().clone();
            assert_eq!(
                got,
                vec![want.to_string()],
                "菜单项 {id} 的点击应恰好发出一个 {want} 事件"
            );
        }
    }
}
