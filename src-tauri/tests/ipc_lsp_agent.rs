//! 模型经 AgentThread、审批和真实 LSP 服务完成工具往返。
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
                "id": "msg-lsp", "model": "claude-mock", "usage": { "input_tokens": 10 }
            }}),
        ),
        (
            "content_block_start",
            json!({ "type": "content_block_start", "index": 0,
                "content_block": { "type": "tool_use", "id": "toolu_agent_lsp", "name": "lsp" }
            }),
        ),
        (
            "content_block_delta",
            json!({ "type": "content_block_delta", "index": 0,
                "delta": { "type": "input_json_delta", "partial_json": "{\"action\":\"hover\",\"file_path\":\"fixture.rs\",\"line\":0,\"character\":3}" }
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
                "id": "msg-lsp-done", "model": "claude-mock", "usage": { "input_tokens": 10 }
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
                "delta": { "type": "text_delta", "text": "LSP roundtrip complete" }
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
fn model_requests_lsp_hover_and_receives_actual_result() {
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
                    .and(body_string_contains("mock-lsp-agent-turn"))
                    .respond_with(
                        ResponseTemplate::new(200).set_body_raw(tool_reply(), "text/event-stream"),
                    ),
            )
            .await;
        server
            .register(
                Mock::given(method("POST"))
                    .and(path("/v1/messages"))
                    .and(body_string_contains("toolu_agent_lsp"))
                    .and(body_string_contains("tool_result"))
                    .and(body_string_contains("fixture hover response"))
                    .respond_with(
                        ResponseTemplate::new(200).set_body_raw(final_reply(), "text/event-stream"),
                    )
                    .with_priority(1),
            )
            .await;
        server
    });
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures/lsp-stdio-server.mjs");
    let fixture = serde_json::to_string(&fixture.to_string_lossy()).unwrap();
    common::set_config_before_install(&format!(
        "[active]\nprovider = \"anthropic\"\n[anthropic]\napi_key = \"test-key\"\nbase_url = \"{}\"\nmodel = \"claude-mock\"\n[hooks]\nenabled = []\n[lsp_servers.fixture]\ncommand = \"node\"\nargs = [{fixture}]\nfile_patterns = [{{ glob = \"**/*.rs\", language_id = \"rust\" }}]\n",
        provider.uri()
    ));
    let (tx, rx) = channel();
    common::listen("reflect_event", move |event: tauri::Event| {
        if let Ok(value) = serde_json::from_str::<Value>(event.payload()) {
            let _ = tx.send(value);
        }
    });
    std::fs::write("fixture.rs", "fn fixture_lsp_source() {}\n").unwrap();
    common::invoke_ok("reflect_lsp_set_enabled", json!({"enabled":true}));
    let mut startup = Vec::new();
    wait_for(&rx, &mut startup, |e| {
        e["msg"]["type"] == "lsp_server_started" && e["msg"]["server"] == "fixture"
    });
    common::invoke_ok("reflect_lsp_warmup", json!({"path":"fixture.rs"}));
    common::invoke_ok("reflect_set_permission_mode", json!({ "mode": "prompt" }));
    common::invoke_ok(
        "reflect_submit",
        json!({
            "submission": { "id": "lsp-agent-submission", "op": { "type": "user_input",
                "items": [{ "type": "text", "text": "mock-lsp-agent-turn" }] } }
        }),
    );

    let mut seen = Vec::new();
    let approval = wait_for(&rx, &mut seen, |e| {
        e["msg"]["type"] == "approval_request" && e["msg"]["kind"]["tool_name"] == "lsp"
    });
    assert_eq!(approval["msg"]["kind"]["args"]["action"], "hover");
    let before_approval = runtime.block_on(provider.received_requests()).unwrap();
    assert_eq!(before_approval.len(), 1);
    let first: Value = serde_json::from_slice(&before_approval[0].body).unwrap();
    assert!(
        first["tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|tool| tool["name"] == "lsp")
    );
    common::invoke_ok(
        "reflect_tool_approval",
        json!({
            "id": approval["msg"]["request_id"], "decision": "approve"
        }),
    );
    wait_for(&rx, &mut seen, |e| {
        e["id"] == "lsp-agent-submission" && e["msg"]["type"] == "turn_complete"
    });
    assert!(seen.iter().any(|e| {
        e["id"] == "lsp-agent-submission"
            && e["msg"]["type"] == "agent_message_delta"
            && e["msg"]["delta"]
                .as_str()
                .is_some_and(|s| s.contains("LSP roundtrip complete"))
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
        .find(|block| block["type"] == "tool_result" && block["tool_use_id"] == "toolu_agent_lsp")
        .expect("第二次模型请求缺少配对的 LSP 工具结果");
    assert_eq!(result["is_error"], false, "{result}");
    assert!(
        result["content"]
            .to_string()
            .contains("fixture hover response"),
        "{result}"
    );
    common::invoke_ok("reflect_lsp_set_enabled", json!({"enabled":false}));
}
