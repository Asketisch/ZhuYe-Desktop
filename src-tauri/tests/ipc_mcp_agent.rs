//! 模型经 AgentThread、审批和真实 MCP 服务完成工具往返。
mod common;

use std::sync::mpsc::{Receiver, channel};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use wiremock::matchers::{body_string_contains, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn sse(events: &[(&str, Value)]) -> String {
    events
        .iter()
        .map(|(name, data)| format!("event: {name}\ndata: {data}\n\n"))
        .collect()
}

fn tool_reply() -> String {
    sse(&[
        (
            "message_start",
            json!({ "type": "message_start", "message": {
                "id": "msg-mcp", "model": "claude-mock", "usage": { "input_tokens": 10 }
            }}),
        ),
        (
            "content_block_start",
            json!({ "type": "content_block_start", "index": 0,
                "content_block": { "type": "tool_use", "id": "toolu_agent_mcp", "name": "mcp__desktop_fixture__echo" }
            }),
        ),
        (
            "content_block_delta",
            json!({ "type": "content_block_delta", "index": 0,
                "delta": { "type": "input_json_delta", "partial_json": "{\"text\":\"agent-call\"}" }
            }),
        ),
        (
            "content_block_stop",
            json!({ "type": "content_block_stop", "index": 0 }),
        ),
        (
            "message_delta",
            json!({ "type": "message_delta", "delta": { "stop_reason": "tool_use" },
            "usage": { "output_tokens": 8 } }),
        ),
        ("message_stop", json!({ "type": "message_stop" })),
    ])
}

fn final_reply() -> String {
    sse(&[
        (
            "message_start",
            json!({ "type": "message_start", "message": {
                "id": "msg-mcp-done", "model": "claude-mock", "usage": { "input_tokens": 10 }
            }}),
        ),
        (
            "content_block_start",
            json!({ "type": "content_block_start", "index": 0,
                "content_block": { "type": "text", "text": "" }
            }),
        ),
        (
            "content_block_delta",
            json!({ "type": "content_block_delta", "index": 0,
                "delta": { "type": "text_delta", "text": "MCP roundtrip complete" }
            }),
        ),
        (
            "content_block_stop",
            json!({ "type": "content_block_stop", "index": 0 }),
        ),
        (
            "message_delta",
            json!({ "type": "message_delta", "delta": { "stop_reason": "end_turn" },
            "usage": { "output_tokens": 5 } }),
        ),
        ("message_stop", json!({ "type": "message_stop" })),
    ])
}

fn wait_for(
    rx: &Receiver<Value>,
    seen: &mut Vec<Value>,
    predicate: impl Fn(&Value) -> bool,
) -> Value {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let event = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .unwrap_or_else(|_| panic!("事件超时，已收到: {seen:#?}"));
        if predicate(&event) {
            return event;
        }
        seen.push(event);
    }
}

#[test]
fn model_requests_mcp_tool_approval_and_receives_actual_result() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    let provider = runtime.block_on(async {
        let server = MockServer::start().await;
        server
            .register(
                Mock::given(method("POST"))
                    .and(path("/v1/messages"))
                    .and(body_string_contains("mock-mcp-agent-turn"))
                    .respond_with(
                        ResponseTemplate::new(200).set_body_raw(tool_reply(), "text/event-stream"),
                    ),
            )
            .await;
        server
            .register(
                Mock::given(method("POST"))
                    .and(path("/v1/messages"))
                    .and(body_string_contains("toolu_agent_mcp"))
                    .and(body_string_contains("tool_result"))
                    .and(body_string_contains("model-roundtrip: agent-call"))
                    .respond_with(
                        ResponseTemplate::new(200).set_body_raw(final_reply(), "text/event-stream"),
                    )
                    .with_priority(1),
            )
            .await;
        server
    });
    common::set_config_before_install(&format!(
        "[active]\nprovider = \"anthropic\"\n[anthropic]\napi_key = \"test-key\"\n\
         base_url = \"{}\"\nmodel = \"claude-mock\"\n[hooks]\nenabled = []\n",
        provider.uri()
    ));
    let (tx, rx) = channel();
    common::listen("reflect_event", move |event: tauri::Event| {
        if let Ok(value) = serde_json::from_str::<Value>(event.payload()) {
            let _ = tx.send(value);
        }
    });
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures/mcp-stdio-server.mjs");
    common::invoke_ok(
        "reflect_upsert_mcp_server",
        json!({
            "name": "desktop_fixture",
            "entry": { "type": "stdio", "command": "node", "args": [fixture],
                "env": { "TEST_GREETING": "model-roundtrip" } }
        }),
    );
    common::invoke_ok("reflect_set_permission_mode", json!({ "mode": "prompt" }));
    common::invoke_ok(
        "reflect_submit",
        json!({
            "submission": { "id": "mcp-agent-submission", "op": { "type": "user_input",
                "items": [{ "type": "text", "text": "mock-mcp-agent-turn" }] } }
        }),
    );

    let mut seen = Vec::new();
    let approval = wait_for(&rx, &mut seen, |e| {
        e["msg"]["type"] == "approval_request"
            && e["msg"]["kind"]["tool_name"] == "mcp__desktop_fixture__echo"
    });
    assert_eq!(approval["msg"]["kind"]["args"]["text"], "agent-call");
    assert!(!seen.iter().any(|e| e["msg"]["type"] == "mcp_tool_invoked"));
    let before_approval = runtime.block_on(provider.received_requests()).unwrap();
    assert_eq!(before_approval.len(), 1);
    let first: Value = serde_json::from_slice(&before_approval[0].body).unwrap();
    assert!(
        first["tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|tool| tool["name"] == "mcp__desktop_fixture__echo")
    );
    common::invoke_ok(
        "reflect_tool_approval",
        json!({
            "id": approval["msg"]["request_id"], "decision": "approve"
        }),
    );
    wait_for(&rx, &mut seen, |e| {
        e["id"] == "mcp-agent-submission" && e["msg"]["type"] == "turn_complete"
    });
    assert!(seen.iter().any(|e| e["msg"]["type"] == "mcp_tool_invoked"
        && e["msg"]["server"] == "desktop_fixture"
        && e["msg"]["tool"] == "echo"));
    assert!(seen.iter().any(|e| {
        e["id"] == "mcp-agent-submission"
            && e["msg"]["type"] == "agent_message_delta"
            && e["msg"]["delta"]
                .as_str()
                .is_some_and(|s| s.contains("MCP roundtrip complete"))
    }));

    let requests = runtime.block_on(provider.received_requests()).unwrap();
    assert_eq!(requests.len(), 2, "模型工具往返应恰好有两次请求");
    let second: Value = serde_json::from_slice(&requests[1].body).unwrap();
    let result = second["messages"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|message| message["content"].as_array())
        .flatten()
        .find(|block| block["type"] == "tool_result" && block["tool_use_id"] == "toolu_agent_mcp")
        .expect("第二次模型请求缺少配对的 MCP 工具结果");
    assert_eq!(result["is_error"], false, "{result}");
    assert!(
        result["content"]
            .to_string()
            .contains("model-roundtrip: agent-call"),
        "{result}"
    );
    common::invoke_ok(
        "reflect_delete_mcp_server",
        json!({ "name": "desktop_fixture" }),
    );
}
