//! 面板输入注入：把桌面面板的鼠标 / 滚轮 / 键盘事件转成 CDP Input 域命令。
//!
//! 与帧流**共用同一条页面级连接**（见 `super::run_page_session`）：
//! screencast 连的是 page target 的 `webSocketDebuggerUrl`，Input 域命令
//! 同属 page 域，直接在同一条连接上发即可 —— 无需每次输入都新建
//! websocket（那会让拖动手感崩掉）。
//!
//! ## 坐标约定
//!
//! 前端送**归一化坐标**（0..1，相对面板里渲染出来的画面），后端乘以
//! 页面 CSS 视口尺寸换算成页面坐标：
//!
//! ```text
//! page_x = nx * viewport_width
//! page_y = ny * viewport_height
//! ```
//!
//! 归一化成立的前提：screencast 帧是视口的**等比缩放**
//! （`maxWidth`/`maxHeight` 约束），帧宽高比与视口一致 —— 故归一化
//! 与缩放因子无关。视口尺寸由 `Page.getLayoutMetrics` 的
//! `cssVisualViewport` 取得（CSS 像素）。
//!
//! ## 修饰键
//!
//! CDP 的 `modifiers` 是位掩码：Alt=1 / Ctrl=2 / Meta=4 / Shift=8。

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::oneshot;

use super::PageCommand;

/// 桌面面板的一次输入事件（前端 → 后端）。
///
/// `x` / `y` 是**归一化坐标**（0..1，相对面板画面）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BrowserInputEvent {
    /// 鼠标移动（hover）。
    MouseMove { x: f64, y: f64, modifiers: u32 },
    /// 鼠标按下。
    MouseDown {
        x: f64,
        y: f64,
        button: String,
        #[serde(alias = "click_count")]
        click_count: u32,
        modifiers: u32,
    },
    /// 鼠标抬起。
    MouseUp {
        x: f64,
        y: f64,
        button: String,
        #[serde(alias = "click_count")]
        click_count: u32,
        modifiers: u32,
    },
    /// 滚轮。
    MouseWheel {
        x: f64,
        y: f64,
        #[serde(alias = "delta_x")]
        delta_x: f64,
        #[serde(alias = "delta_y")]
        delta_y: f64,
        modifiers: u32,
    },
    /// 键盘（`action` = `down` / `up`）。
    Key {
        action: String,
        key: String,
        code: String,
        #[serde(default)]
        text: Option<String>,
        /// 前端可给出虚拟键码；缺省时后端按 `key` 推导。
        #[serde(default)]
        #[serde(alias = "virtual_key_code")]
        virtual_key_code: Option<u32>,
        modifiers: u32,
    },
}

/// Alt=1 / Ctrl=2 / Meta=4 / Shift=8 的位掩码。
pub const MODIFIER_ALT: u32 = 1;
pub const MODIFIER_CTRL: u32 = 2;
pub const MODIFIER_META: u32 = 4;
pub const MODIFIER_SHIFT: u32 = 8;

/// 已知修饰键位的全集。
pub const MODIFIER_MASK: u32 = MODIFIER_ALT | MODIFIER_CTRL | MODIFIER_META | MODIFIER_SHIFT;

/// 只保留已知位(前端若传了别的位,丢弃 —— CDP 不认自定义位)。
pub fn sanitize_modifiers(modifiers: u32) -> u32 {
    modifiers & MODIFIER_MASK
}

/// 归一化坐标 → 页面 CSS 像素坐标。
pub fn map_point(nx: f64, ny: f64, viewport: (f64, f64)) -> (f64, f64) {
    (nx * viewport.0, ny * viewport.1)
}

/// 特殊键的 Windows 虚拟键码（CDP 的 `windowsVirtualKeyCode`）。
///
/// 可打印 ASCII 用其码位；其余按 WebKit/Chromium 的常规映射。
pub fn virtual_key_code(key: &str) -> u32 {
    match key {
        "Backspace" => 8,
        "Tab" => 9,
        "Enter" => 13,
        "Shift" => 16,
        "Control" => 17,
        "Alt" => 18,
        "Pause" => 19,
        "CapsLock" => 20,
        "Escape" => 27,
        " " => 32,
        "PageUp" => 33,
        "PageDown" => 34,
        "End" => 35,
        "Home" => 36,
        "ArrowLeft" => 37,
        "ArrowUp" => 38,
        "ArrowRight" => 39,
        "ArrowDown" => 40,
        "Insert" => 45,
        "Delete" => 46,
        "Meta" => 91,
        "ContextMenu" => 93,
        "F1" => 112,
        "F2" => 113,
        "F3" => 114,
        "F4" => 115,
        "F5" => 116,
        "F6" => 117,
        "F7" => 118,
        "F8" => 119,
        "F9" => 120,
        "F10" => 121,
        "F11" => 122,
        "F12" => 123,
        _ => {
            // 单字符可打印键：取其码位（Unicode 码点即 ASCII 时等价）。
            let mut chars = key.chars();
            match (chars.next(), chars.next()) {
                (Some(c), None) if !c.is_control() => c as u32,
                _ => 0,
            }
        }
    }
}

/// 键盘事件的 CDP 参数（`Input.dispatchKeyEvent`）。
///
/// `keyDown` 携带 `text`（可打印字符才有），`keyUp` 不带 —— 与
/// Chromium 自身的键盘事件序列一致。
pub fn key_event_params(
    action: &str,
    key: &str,
    code: &str,
    text: Option<&str>,
    vkey: u32,
    modifiers: u32,
) -> Value {
    let mut params = json!({
        "type": if action == "up" { "keyUp" } else { "keyDown" },
        "key": key,
        "code": code,
        "windowsVirtualKeyCode": vkey,
        "modifiers": modifiers,
    });
    if action != "up" {
        if let Some(t) = text {
            if !t.is_empty() {
                params["text"] = json!(t);
            }
        }
    }
    params
}

/// 鼠标事件的 CDP 参数（`Input.dispatchMouseEvent`）。
pub fn mouse_event_params(
    event_type: &str,
    x: f64,
    y: f64,
    button: &str,
    click_count: u32,
    modifiers: u32,
) -> Value {
    json!({
        "type": event_type,
        "x": x,
        "y": y,
        "button": button,
        "clickCount": click_count,
        "modifiers": modifiers,
    })
}

/// 把一次输入事件翻译成页面域 CDP 命令（方法 + 参数）。
///
/// 坐标在此处由归一化换算成页面像素 —— 调用方需给出页面 CSS 视口尺寸。
pub fn to_cdp_command(event: &BrowserInputEvent, viewport: (f64, f64)) -> (String, Value) {
    match event {
        BrowserInputEvent::MouseMove { x, y, modifiers } => {
            let (px, py) = map_point(*x, *y, viewport);
            (
                "Input.dispatchMouseEvent".to_string(),
                mouse_event_params(
                    "mouseMoved",
                    px,
                    py,
                    "none",
                    0,
                    sanitize_modifiers(*modifiers),
                ),
            )
        }
        BrowserInputEvent::MouseDown {
            x,
            y,
            button,
            click_count,
            modifiers,
        } => {
            let (px, py) = map_point(*x, *y, viewport);
            (
                "Input.dispatchMouseEvent".to_string(),
                mouse_event_params(
                    "mousePressed",
                    px,
                    py,
                    button,
                    *click_count,
                    sanitize_modifiers(*modifiers),
                ),
            )
        }
        BrowserInputEvent::MouseUp {
            x,
            y,
            button,
            click_count,
            modifiers,
        } => {
            let (px, py) = map_point(*x, *y, viewport);
            (
                "Input.dispatchMouseEvent".to_string(),
                mouse_event_params(
                    "mouseReleased",
                    px,
                    py,
                    button,
                    *click_count,
                    sanitize_modifiers(*modifiers),
                ),
            )
        }
        BrowserInputEvent::MouseWheel {
            x,
            y,
            delta_x,
            delta_y,
            modifiers,
        } => {
            let (px, py) = map_point(*x, *y, viewport);
            let mut params = mouse_event_params(
                "mouseWheel",
                px,
                py,
                "none",
                0,
                sanitize_modifiers(*modifiers),
            );
            params["deltaX"] = json!(delta_x);
            params["deltaY"] = json!(delta_y);
            ("Input.dispatchMouseEvent".to_string(), params)
        }
        BrowserInputEvent::Key {
            action,
            key,
            code,
            text,
            virtual_key_code,
            modifiers,
        } => {
            let vkey = virtual_key_code.unwrap_or_else(|| virtual_key_code_for(key));
            (
                "Input.dispatchKeyEvent".to_string(),
                key_event_params(
                    action,
                    key,
                    code,
                    text.as_deref(),
                    vkey,
                    sanitize_modifiers(*modifiers),
                ),
            )
        }
    }
}

/// 事件里给定的虚拟键码优先，缺省按 `key` 推导。
fn virtual_key_code_for(key: &str) -> u32 {
    virtual_key_code(key)
}

/// 把一次输入事件投递给页面会话（等待其回执）。
///
/// 浏览器未启动 / 会话已结束 → 结构化错误。
pub async fn dispatch(
    agent: &crate::state::MinimalAgent,
    event: BrowserInputEvent,
) -> Result<(), String> {
    // 取 sender 后立刻释放锁：不能在持锁状态下 await（会与 status() 互锁）。
    let tx = {
        let manager = agent.inner.browser.lock().await;
        manager.input_tx.clone()
    };
    let tx = tx.ok_or_else(|| "浏览器面板未启动(先在面板里启动浏览器)".to_string())?;
    let (reply_tx, reply_rx) = oneshot::channel();
    tx.send(PageCommand::Input {
        event,
        reply: reply_tx,
    })
    .await
    .map_err(|_| "浏览器会话已结束,请重新启动浏览器".to_string())?;
    reply_rx
        .await
        .map_err(|_| "浏览器会话已结束,请重新启动浏览器".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_events_accept_frontend_camel_case_fields() {
        let mouse: BrowserInputEvent = serde_json::from_value(json!({"type":"mouseDown", "x":0.5, "y":0.5, "button":"left", "clickCount":2, "modifiers":0})).unwrap();
        assert!(matches!(
            mouse,
            BrowserInputEvent::MouseDown { click_count: 2, .. }
        ));
        let wheel: BrowserInputEvent = serde_json::from_value(
            json!({"type":"mouseWheel", "x":0.5, "y":0.5, "deltaX":1, "deltaY":-10, "modifiers":0}),
        )
        .unwrap();
        assert!(matches!(
            wheel,
            BrowserInputEvent::MouseWheel {
                delta_x: 1.0,
                delta_y: -10.0,
                ..
            }
        ));
        let key: BrowserInputEvent = serde_json::from_value(json!({"type":"key", "action":"down", "key":"a", "code":"KeyA", "virtualKeyCode":65, "modifiers":0})).unwrap();
        assert!(matches!(
            key,
            BrowserInputEvent::Key {
                virtual_key_code: Some(65),
                ..
            }
        ));
    }

    #[test]
    fn sanitize_modifiers_keeps_only_known_bits() {
        assert_eq!(sanitize_modifiers(0), 0);
        assert_eq!(sanitize_modifiers(1 | 2 | 4 | 8), 15);
        // 未知位被丢弃
        assert_eq!(sanitize_modifiers(16), 0);
        assert_eq!(sanitize_modifiers(1 | 64), 1);
    }

    #[test]
    fn map_point_scales_by_viewport() {
        assert_eq!(map_point(0.5, 0.25, (1280.0, 800.0)), (640.0, 200.0));
        assert_eq!(map_point(0.0, 0.0, (1280.0, 800.0)), (0.0, 0.0));
        assert_eq!(map_point(1.0, 1.0, (1280.0, 800.0)), (1280.0, 800.0));
    }

    #[test]
    fn virtual_key_code_covers_special_and_printable_keys() {
        assert_eq!(virtual_key_code("Enter"), 13);
        assert_eq!(virtual_key_code("Tab"), 9);
        assert_eq!(virtual_key_code("Backspace"), 8);
        assert_eq!(virtual_key_code("Delete"), 46);
        assert_eq!(virtual_key_code("Escape"), 27);
        assert_eq!(virtual_key_code("ArrowLeft"), 37);
        assert_eq!(virtual_key_code("ArrowDown"), 40);
        assert_eq!(virtual_key_code("a"), 'a' as u32);
        assert_eq!(virtual_key_code("Z"), 'Z' as u32);
        // 多字符键名没有对应虚拟键码
        assert_eq!(virtual_key_code("Shift"), 16);
    }

    #[test]
    fn key_down_carries_text_but_key_up_does_not() {
        let down = key_event_params("down", "a", "KeyA", Some("a"), 65, 0);
        assert_eq!(down["type"], "keyDown");
        assert_eq!(down["text"], "a");
        assert_eq!(down["windowsVirtualKeyCode"], 65);

        let up = key_event_params("up", "a", "KeyA", Some("a"), 65, 0);
        assert_eq!(up["type"], "keyUp");
        assert!(up.get("text").is_none());
    }

    #[test]
    fn key_event_without_text_omits_text_field() {
        let params = key_event_params("down", "Enter", "Enter", None, 13, 0);
        assert!(params.get("text").is_none());
        assert_eq!(params["type"], "keyDown");
    }

    #[test]
    fn mouse_down_uses_pressed_type_and_click_count() {
        let event = BrowserInputEvent::MouseDown {
            x: 0.5,
            y: 0.5,
            button: "left".to_string(),
            click_count: 2,
            modifiers: 0,
        };
        let (method, params) = to_cdp_command(&event, (1000.0, 500.0));
        assert_eq!(method, "Input.dispatchMouseEvent");
        assert_eq!(params["type"], "mousePressed");
        assert_eq!(params["clickCount"], 2);
        assert_eq!(params["x"], 500.0);
        assert_eq!(params["y"], 250.0);
    }

    #[test]
    fn mouse_wheel_carries_deltas() {
        let event = BrowserInputEvent::MouseWheel {
            x: 0.25,
            y: 0.75,
            delta_x: 0.0,
            delta_y: -120.0,
            modifiers: 0,
        };
        let (_, params) = to_cdp_command(&event, (800.0, 600.0));
        assert_eq!(params["type"], "mouseWheel");
        assert_eq!(params["deltaY"], -120.0);
        assert_eq!(params["x"], 200.0);
        assert_eq!(params["y"], 450.0);
    }

    #[test]
    fn key_command_falls_back_to_derived_virtual_key_code() {
        let event = BrowserInputEvent::Key {
            action: "down".to_string(),
            key: "Enter".to_string(),
            code: "Enter".to_string(),
            text: None,
            virtual_key_code: None,
            modifiers: 0,
        };
        let (method, params) = to_cdp_command(&event, (800.0, 600.0));
        assert_eq!(method, "Input.dispatchKeyEvent");
        assert_eq!(params["windowsVirtualKeyCode"], 13);
    }
}
