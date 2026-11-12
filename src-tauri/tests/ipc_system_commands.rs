//! 系统集成命令的真实 IPC 契约测试。
//!
//! 只触达可安全自动化的分支:不会真的截屏、移动鼠标或打开文件管理器。
//! 真实宿主操作由媒体后端的单元测试与真窗口层承担。

mod common;

use serde_json::json;

#[test]
fn reveal_path_rejects_missing_path() {
    let _guard = common::state_lock();
    let error = common::invoke_err(
        "reflect_reveal_path",
        json!({ "path": "/definitely/not/a/real/path/v1" }),
    );
    let text = error.to_string();
    assert!(
        text.contains("path does not exist"),
        "缺失路径应返回明确错误:{text}"
    );
}

#[test]
fn computer_use_rejects_screenshot_action_with_dedicated_command_pointer() {
    let _guard = common::state_lock();
    let error = common::invoke_err(
        "reflect_computer_use",
        json!({ "action": { "kind": "screenshot" } }),
    );
    let text = error.to_string();
    assert!(
        text.contains("use reflect_screenshot for captures"),
        "Screenshot 动作应引导到独立命令:{text}"
    );
}

#[test]
fn tailscale_daemon_commands_report_unimplemented_contract() {
    let _guard = common::state_lock();
    for command in [
        "reflect_tailscale_daemon_start",
        "reflect_tailscale_daemon_stop",
        "reflect_tailscale_daemon_status",
    ] {
        let value = common::invoke_ok(command, json!({}));
        assert_eq!(
            value.as_str(),
            Some("not implemented yet (Phase 2 follow-up)"),
            "{command} 应如实返回未实现占位语义:{value}"
        );
    }
}
