//! Nested subagents delegate through real AgentThreads and return grandchild output.
#![cfg(unix)]
mod common;

use std::sync::mpsc::{Receiver, channel};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use wiremock::matchers::{body_string_contains, method, path};
use wiremock::{Match, Mock, MockServer, Request, ResponseTemplate};

struct BodyExcludes(&'static str);

impl Match for BodyExcludes {
    fn matches(&self, request: &Request) -> bool {
        std::str::from_utf8(&request.body)
            .map(|body| !body.contains(self.0))
            .unwrap_or(false)
    }
}

fn reply(tool: bool, text: &str) -> String {
    let tool_prompt = if text.is_empty() {
        "nested-grandchild-marker"
    } else {
        text
    };
    let (block, delta, stop) = if tool {
        (
            json!({"type":"tool_use","id":"toolu_nested","name":"call_nested"}),
            json!({"type":"input_json_delta","partial_json":format!("{{\"prompt\":\"{tool_prompt}\"}}")}),
            "tool_use",
        )
    } else {
        (
            json!({"type":"text","text":""}),
            json!({"type":"text_delta","text":text}),
            "end_turn",
        )
    };
    [
        ("message_start", json!({"type":"message_start","message":{"id":"nested-message","model":"claude-mock","usage":{"input_tokens":5}}})),
        ("content_block_start", json!({"type":"content_block_start","index":0,"content_block":block})),
        ("content_block_delta", json!({"type":"content_block_delta","index":0,"delta":delta})),
        ("content_block_stop", json!({"type":"content_block_stop","index":0})),
        ("message_delta", json!({"type":"message_delta","delta":{"stop_reason":stop},"usage":{"output_tokens":5}})),
        ("message_stop", json!({"type":"message_stop"})),
    ].iter().map(|(name, data)| format!("event: {name}\ndata: {data}\n\n")).collect()
}

fn wait_for(
    rx: &Receiver<Value>,
    seen: &mut Vec<Value>,
    predicate: impl Fn(&Value) -> bool,
) -> Value {
    let deadline = Instant::now() + Duration::from_secs(45);
    loop {
        let event = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .unwrap_or_else(|_| panic!("event timeout: {seen:#?}"));
        if predicate(&event) {
            return event;
        }
        seen.push(event);
    }
}

#[test]
fn nested_subagents_return_grandchild_result_to_parent() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    let provider = runtime.block_on(async {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("nested-parent-marker"))
            .and(BodyExcludes("nested-child-marker"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_raw(reply(true, "nested-child-marker"), "text/event-stream"),
            )
            .with_priority(2)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("nested-child-marker"))
            .and(BodyExcludes("nested-grandchild-marker"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_raw(reply(true, "nested-grandchild-marker"), "text/event-stream"),
            )
            .with_priority(2)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("nested-child-marker"))
            .and(body_string_contains("tool_result"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_raw(reply(false, "nested-child-done"), "text/event-stream"),
            )
            .with_priority(2)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("nested-grandchild-marker"))
            .and(BodyExcludes("tool_result"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_raw(reply(false, "nested-grandchild-done"), "text/event-stream"),
            )
            .with_priority(2)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("nested-parent-marker"))
            .and(body_string_contains("nested-child-marker"))
            .and(body_string_contains("tool_result"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_raw(reply(false, "parent-received-nested"), "text/event-stream"),
            )
            .with_priority(1)
            .mount(&server)
            .await;
        server
    });
    common::set_config_before_install(&format!(
        "[active]\nprovider = \"anthropic\"\n[anthropic]\napi_key = \"test-key\"\nbase_url = \"{}\"\nmodel = \"claude-mock\"\n[hooks]\nenabled = []\n",
        provider.uri()
    ));
    let (tx, rx) = channel();
    common::listen("reflect_event", move |event: tauri::Event| {
        if let Ok(value) = serde_json::from_str(event.payload()) {
            let _ = tx.send(value);
        }
    });
    let spec_dir = std::path::Path::new(".zhuye/subagents");
    std::fs::create_dir_all(spec_dir).unwrap();
    std::fs::write(
        spec_dir.join("nested.md"),
        "---\nname: Nested Runner\nrole: nested\nallowed_tools: [call_nested]\n---\nDelegate nested work when asked.\n",
    ).unwrap();
    let session = common::invoke_ok("reflect_create_session", json!({}));
    common::invoke_ok("reflect_bind_session", json!({"id":session}));
    let tools: Value = common::invoke_ok("reflect_list_tools", json!({}));
    assert!(
        tools
            .as_array()
            .is_some_and(|items| items.iter().any(|tool| tool["name"] == "call_nested")),
        "call_nested tool missing: {tools}"
    );
    let specs: Value = common::invoke_ok("reflect_list_subagent_specs", json!({}));
    assert!(
        specs
            .as_array()
            .is_some_and(|items| items.iter().any(|spec| spec["role"] == "nested")),
        "workspace nested spec missing: {specs}"
    );
    common::invoke_ok("reflect_set_permission_mode", json!({"mode":"prompt"}));
    common::invoke_ok(
        "reflect_submit",
        json!({"submission":{"id":"nested-parent-turn","op":{"type":"user_input","items":[{"type":"text","text":"nested-parent-marker"}]}}}),
    );
    let mut seen = Vec::new();
    let approval = wait_for(&rx, &mut seen, |event| {
        event["msg"]["type"] == "approval_request"
            && event["msg"]["kind"]["tool_name"] == "call_nested"
    });
    common::invoke_ok(
        "reflect_tool_approval",
        json!({"id":approval["msg"]["request_id"], "decision":"approve"}),
    );
    wait_for(&rx, &mut seen, |event| {
        event["id"] == "nested-parent-turn" && event["msg"]["type"] == "turn_complete"
    });
    assert!(
        seen.iter().any(|event| {
            event["id"] == "nested-parent-turn"
                && event["msg"]["type"] == "agent_message_delta"
                && event["msg"]["delta"] == "parent-received-nested"
        }),
        "{seen:#?}"
    );
    let requests = runtime.block_on(provider.received_requests()).unwrap();
    assert_eq!(
        requests.len(),
        5,
        "parent, child, grandchild, child final, parent final"
    );
    let bodies: Vec<_> = requests
        .iter()
        .map(|request| String::from_utf8_lossy(&request.body).into_owned())
        .collect();
    assert!(
        bodies
            .last()
            .is_some_and(|body| body.contains("nested-grandchild-done")
                && body.contains("nested-child-done")
                && body.contains("tool_result")),
        "nested results were not returned through child and parent final requests"
    );
}
