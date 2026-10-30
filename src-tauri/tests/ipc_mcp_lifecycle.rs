//! MCP 服务在空配置启动后添加时，生命周期事件仍须送达前端。
mod common;

#[test]
fn newly_added_server_reports_start_failure() {
    let (tx, rx) = std::sync::mpsc::channel();
    common::listen("reflect_event", move |event: tauri::Event| {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(event.payload()) {
            let _ = tx.send(value);
        }
    });
    common::invoke_ok(
        "reflect_upsert_mcp_server",
        serde_json::json!({
            "name": "missing-local-server",
            "entry": { "type": "stdio", "command": "/nonexistent/reflect-mcp-test" }
        }),
    );
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    let mut found = false;
    while let Ok(event) =
        rx.recv_timeout(deadline.saturating_duration_since(std::time::Instant::now()))
    {
        if event["msg"]["type"] == "mcp_server_failed"
            && event["msg"]["server"] == "missing-local-server"
        {
            assert_eq!(event["id"], "");
            found = true;
            break;
        }
    }
    assert!(found, "server failure must reach reflect_event");
}
