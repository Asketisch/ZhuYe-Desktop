//! MCP 服务动态配置、调用与生命周期事件的真实后端集成。
mod common;

use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tauri::Manager;

fn wait_event(rx: &Receiver<Value>, kind: &str, server: &str) -> Value {
    let deadline = Instant::now() + Duration::from_secs(15);
    while let Ok(event) = rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
        if event["msg"]["type"] == kind && event["msg"]["server"] == server {
            return event;
        }
    }
    panic!("missing {kind} event for {server}");
}

#[test]
fn local_server_connects_invokes_reloads_and_unregisters() {
    let (tx, rx) = std::sync::mpsc::channel();
    common::listen("reflect_event", move |event: tauri::Event| {
        if let Ok(value) = serde_json::from_str::<Value>(event.payload()) {
            let _ = tx.send(value);
        }
    });
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures/mcp-stdio-server.mjs");
    let configure = |greeting: &str| {
        common::invoke_ok(
            "reflect_upsert_mcp_server",
            json!({
                "name": "desktop_fixture",
                "entry": { "type": "stdio", "command": "node", "args": [fixture],
                    "env": { "TEST_GREETING": greeting } }
            }),
        );
    };

    configure("first");
    let started = wait_event(&rx, "mcp_server_started", "desktop_fixture");
    assert_eq!(started["id"], "");
    assert_eq!(started["msg"]["tool_count"], 1);
    let servers = common::invoke_ok("reflect_list_mcp_servers", json!({}));
    assert!(
        servers
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["name"] == "desktop_fixture" && s["running"] == true)
    );

    let tools = {
        let h = common::harness();
        h.app
            .state::<reflect_desktop_lib::state::MinimalAgent>()
            .tools()
    };
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let invoke = || {
        let tool = tools
            .get("mcp__desktop_fixture__echo")
            .expect("registered MCP tool");
        let mut ctx = reflect_tools::ToolContext::for_workspace(std::env::current_dir().unwrap());
        ctx.call_id = "desktop-fixture-call".into();
        runtime
            .block_on(tool.execute(ctx, json!({ "text": "hello" })))
            .unwrap()
    };
    let result = invoke();
    assert!(!result.is_error, "{result:?}");
    assert!(
        result.content.iter().any(|block| matches!(
            block,
            reflect_protocol::ContentBlock::Text { text } if text == "first: hello"
        )),
        "{result:?}"
    );
    let invoked = wait_event(&rx, "mcp_tool_invoked", "desktop_fixture");
    assert_eq!(invoked["msg"]["tool"], "echo");
    assert_eq!(invoked["msg"]["call_id"], "desktop-fixture-call");

    configure("second");
    wait_event(&rx, "mcp_server_started", "desktop_fixture");
    let reloaded = invoke();
    assert!(!reloaded.is_error, "{reloaded:?}");
    assert!(
        reloaded.content.iter().any(|block| matches!(
            block,
            reflect_protocol::ContentBlock::Text { text } if text == "second: hello"
        )),
        "{reloaded:?}"
    );
    common::invoke_ok(
        "reflect_delete_mcp_server",
        json!({ "name": "desktop_fixture" }),
    );
    assert!(tools.get("mcp__desktop_fixture__echo").is_none());
    let servers = common::invoke_ok("reflect_list_mcp_servers", json!({}));
    assert!(
        !servers
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["name"] == "desktop_fixture")
    );
}

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
