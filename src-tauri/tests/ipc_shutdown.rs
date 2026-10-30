//! 关闭操作在独立进程中验证，避免影响共享代理的其他 IPC 用例。
mod common;

use serde_json::json;

#[test]
fn shutdown_rejects_submissions_until_a_session_is_rebound() {
    // 未知 id 绑定空历史；独立进程避免影响其他并发命令用例。
    let id = "00000000-0000-0000-0000-000000000001";
    assert!(common::invoke_ok("reflect_bind_session", json!({ "id": id })).is_string());
    assert_eq!(
        common::invoke_ok("reflect_agent_status", json!({}))["ready"],
        true
    );
    assert!(common::invoke_ok("reflect_shutdown", json!({})).is_string());
    assert_eq!(
        common::invoke_ok("reflect_agent_status", json!({}))["ready"],
        false
    );
    let error = common::invoke_err("reflect_interrupt", json!({}));
    assert!(
        error.to_string().contains("session thread is closed"),
        "{error}"
    );
    common::invoke_ok("reflect_bind_session", json!({ "id": id }));
    assert_eq!(
        common::invoke_ok("reflect_agent_status", json!({}))["ready"],
        true
    );
    assert!(common::invoke_ok("reflect_interrupt", json!({})).is_string());
}
