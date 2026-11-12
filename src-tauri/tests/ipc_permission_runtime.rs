//! 用户保存的 deny 规则必须立即约束下一次真实工具调用。
mod common;

use serde_json::{Value, json};
use std::sync::mpsc::{Receiver, channel};
use std::time::{Duration, Instant};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

fn stream(tool: Option<(&str, Value)>) -> String {
    let (block, delta, stop) = if let Some((id, args)) = tool {
        (
            json!({"type":"tool_use","id":id,"name":"bash"}),
            json!({"type":"input_json_delta","partial_json":args.to_string()}),
            "tool_use",
        )
    } else {
        (
            json!({"type":"text","text":""}),
            json!({"type":"text_delta","text":"permission result received"}),
            "end_turn",
        )
    };
    [
        ("message_start", json!({"type":"message_start","message":{"id":"permission-runtime","model":"claude-mock","usage":{"input_tokens":5}}})),
        ("content_block_start", json!({"type":"content_block_start","index":0,"content_block":block})),
        ("content_block_delta", json!({"type":"content_block_delta","index":0,"delta":delta})),
        ("content_block_stop", json!({"type":"content_block_stop","index":0})),
        ("message_delta", json!({"type":"message_delta","delta":{"stop_reason":stop},"usage":{"output_tokens":5}})),
        ("message_stop", json!({"type":"message_stop"})),
    ]
    .iter()
    .map(|(name, data)| format!("event: {name}\ndata: {data}\n\n"))
    .collect()
}

fn listen() -> Receiver<Value> {
    let (tx, rx) = channel();
    common::listen("reflect_event", move |event: tauri::Event| {
        if let Ok(value) = serde_json::from_str(event.payload()) {
            let _ = tx.send(value);
        }
    });
    rx
}

fn wait_terminal(rx: &Receiver<Value>, id: &str) -> Vec<Value> {
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut seen = Vec::new();
    loop {
        let event = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .unwrap_or_else(|_| panic!("turn {id} did not finish: {seen:#?}"));
        if event["id"] == id && event["msg"]["type"] == "turn_complete" {
            return seen;
        }
        seen.push(event);
    }
}

#[test]
fn saved_deny_rule_blocks_the_next_bash_call() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    let provider = runtime.block_on(async {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .respond_with(|request: &Request| {
                let body = String::from_utf8_lossy(&request.body);
                let payload =
                    if body.contains("permission-deny-marker") && body.contains("tool_result") {
                        stream(None)
                    } else {
                        stream(Some((
                            "toolu_permission",
                            json!({"cmd":"printf should-not-run > permission-runtime-marker"}),
                        )))
                    };
                ResponseTemplate::new(200).set_body_raw(payload, "text/event-stream")
            })
            .mount(&server)
            .await;
        server
    });
    common::set_config_before_install(&format!(
        "[active]\nprovider = \"anthropic\"\n[anthropic]\napi_key = \"test-key\"\nbase_url = \"{}\"\nmodel = \"claude-mock\"\n[hooks]\nenabled = []\n",
        provider.uri()
    ));
    common::invoke_ok(
        "reflect_add_permission_rule",
        json!({"rule":{"tool":"bash","action":"deny","shell_pattern":"*permission-deny-marker*"}}),
    );
    let rules = common::invoke_ok("reflect_list_permission_rules", json!({}));
    assert!(
        rules.to_string().contains("bash"),
        "saved rule not visible: {rules}"
    );

    let rx = listen();
    let session = common::invoke_ok("reflect_create_session", json!({}));
    common::invoke_ok("reflect_bind_session", json!({"id":session}));
    common::invoke_ok("reflect_set_permission_mode", json!({"mode":"auto"}));
    common::invoke_ok(
        "reflect_submit",
        json!({"submission":{"id":"permission-deny-turn","op":{"type":"user_input","items":[{"type":"text","text":"permission-deny-marker"}]}}}),
    );
    let seen = wait_terminal(&rx, "permission-deny-turn");
    let result = seen
        .iter()
        .find(|event| {
            event["msg"]["type"] == "tool_call_end" && event["msg"]["call_id"] == "toolu_permission"
        })
        .expect("tool result missing");
    assert_eq!(result["msg"]["is_error"], true, "{result}");
    assert!(
        !std::path::Path::new("permission-runtime-marker").exists(),
        "denied bash call produced its side effect"
    );

    let requests = runtime.block_on(provider.received_requests()).unwrap();
    assert_eq!(requests.len(), 2, "tool result must reach the model");
    let second: Value = serde_json::from_slice(&requests[1].body).unwrap();
    assert!(
        second.to_string().contains("denied") || second.to_string().contains("Permission"),
        "deny reason did not reach the model: {second}"
    );
}
