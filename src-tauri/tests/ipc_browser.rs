//! 能力覆盖层 · 受控浏览器 —— 真实命令体 over 真实 IPC 通路。
//!
//! 覆盖:面板状态查询(无副作用)/ 启动的结构化错误路径(句柄未就绪,
//! **绝不**在测试环境拉起真浏览器)/ 导航命令的结构化错误路径(无实例
//! 时不连 CDP)/ 诊断 env。帧流本体(screencast)与真实导航需要真浏览器
//! + 真 GUI,属实机验收(见 docs/plans/browser-control.md)。

mod common;

use common::{invoke, invoke_ok, state_lock};
use serde_json::json;

/// 无运行实例时导航族命令的统一断言:结构化错误、不得真的连 CDP。
fn assert_navigation_fails_structured(cmd: &str, body: serde_json::Value) {
    let _guard = state_lock();
    // 隔离 HOME 下无 DevToolsActivePort → 结构化错误(浏览器未运行)。
    let result = invoke(cmd, body);
    assert!(result.is_err(), "无实例时 `{cmd}` 不应成功");
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("DevToolsActivePort") || err.contains("CDP"),
        "错误应说明浏览器不可达: {err}"
    );
}

#[test]
fn browser_status_reports_not_running_without_instance() {
    let _guard = state_lock();
    // 隔离 HOME 下无 DevToolsActivePort → running=false 的结构化状态,
    // 不 panic、不启动浏览器(status 无副作用)。
    let status = invoke_ok("zhuye_browser_status", json!({}));
    assert_eq!(status["running"], false, "{status}");
    assert_eq!(status["streaming"], false, "{status}");
    assert!(status["url"].is_null(), "{status}");
}

#[test]
fn browser_start_fails_structured_without_app_handle() {
    let _guard = state_lock();
    // 夹具不注入句柄 → 启动必须返回结构化错误(且**早于**任何浏览器探测
    // / 启动动作 —— 顺序错了会真的拉起本机 Chrome)。
    let result = invoke("zhuye_browser_start", json!({}));
    assert!(result.is_err(), "无句柄时 start 不应成功: {result:?}");
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("句柄") || err.contains("handle"),
        "错误应说明句柄未就绪: {err}"
    );
}

#[test]
fn browser_stop_is_idempotent_without_instance() {
    let _guard = state_lock();
    // 无运行实例 → stop 幂等返回结构化状态(streaming=false)。
    let status = invoke_ok("zhuye_browser_stop", json!({}));
    assert_eq!(status["streaming"], false, "{status}");
    // message 说明处置方式(外部实例保留 / 本应用实例回收)。
    assert!(status["message"].is_string(), "{status}");
}

#[test]
fn browser_env_reports_profile_dir_and_override() {
    let _guard = state_lock();
    let env = invoke_ok("zhuye_browser_env", json!({}));
    // 隔离 HOME:profile 目录在隔离数据目录下,不含真实用户路径。
    assert!(env["profileDir"].is_string(), "{env}");
    let profile = env["profileDir"].as_str().unwrap();
    assert!(
        profile.ends_with("browser-profile"),
        "profile 目录应为 browser-profile: {profile}"
    );
    // 夹具不设 ZHUYE_BROWSER_EXECUTABLE → override=false。
    assert_eq!(env["executableOverride"], false, "{env}");
}

#[test]
fn browser_navigate_fails_structured_without_instance() {
    // 无实例 → 结构化错误,不拉起浏览器;地址规范化在后端单测覆盖
    // (browser_backend/nav.rs)。
    assert_navigation_fails_structured("zhuye_browser_navigate", json!({ "url": "example.com" }));
}

#[test]
fn browser_back_forward_fail_structured_without_instance() {
    assert_navigation_fails_structured("zhuye_browser_back", json!({}));
    assert_navigation_fails_structured("zhuye_browser_forward", json!({}));
}

#[test]
fn browser_reload_fails_structured_without_instance() {
    assert_navigation_fails_structured("zhuye_browser_reload", json!({}));
}

#[test]
fn browser_set_device_fails_structured_without_instance() {
    assert_navigation_fails_structured(
        "zhuye_browser_set_device",
        json!({ "width": 390, "height": 844 }),
    );
}
