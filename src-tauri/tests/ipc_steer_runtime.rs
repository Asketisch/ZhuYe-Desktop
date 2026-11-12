//! `reflect_steer` 在运行中的回合抢占并进入后续模型上下文。
mod common;

use serde_json::{Value, json};
use std::sync::mpsc::{Receiver, channel};
use std::time::{Duration, Instant};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

fn reply(text: &str) -> String {
    [
        ("message_start", json!({"type":"message_start","message":{"id":"steer-runtime","model":"claude-mock","usage":{"input_tokens":5}}})),
        ("content_block_start", json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}})),
        ("content_block_delta", json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":text}})),
        ("content_block_stop", json!({"type":"content_block_stop","index":0})),
        ("message_delta", json!({"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}})),
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

fn wait_terminal(rx: &Receiver<Value>, id: &str) {
    let deadline = Instant::now() + Duration::from_secs(40);
    loop {
        let event = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .unwrap_or_else(|_| panic!("turn {id} did not finish"));
        if event["id"] == id && event["msg"]["type"] == "turn_complete" {
            return;
        }
    }
}

#[test]
fn steer_during_a_turn_reaches_the_next_model_request() {
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
                if body.contains("steer-injected-marker") {
                    ResponseTemplate::new(200)
                        .set_body_raw(reply("steer received"), "text/event-stream")
                } else {
                    ResponseTemplate::new(200)
                        .set_body_raw(reply("first turn done"), "text/event-stream")
                        .set_delay(Duration::from_millis(500))
                }
            })
            .mount(&server)
            .await;
        server
    });
    common::set_config_before_install(&format!(
        "[active]\nprovider = \"anthropic\"\n[anthropic]\napi_key = \"test-key\"\nbase_url = \"{}\"\nmodel = \"claude-mock\"\n[hooks]\nenabled = []\n",
        provider.uri()
    ));
    let rx = listen();
    let session = common::invoke_ok("reflect_create_session", json!({}));
    common::invoke_ok("reflect_bind_session", json!({"id":session}));
    common::invoke_ok(
        "reflect_submit",
        json!({"submission":{"id":"steer-runtime-turn","op":{"type":"user_input","items":[{"type":"text","text":"start-steer-runtime-turn"}]}}}),
    );
    common::invoke_ok(
        "reflect_steer",
        json!({"items":[{"type":"text","text":"steer-injected-marker"}],"priority":"now"}),
    );
    wait_terminal(&rx, "steer-runtime-turn");

    let requests = runtime.block_on(provider.received_requests()).unwrap();
    assert!(!requests.is_empty());
    assert!(
        requests
            .iter()
            .any(|request| String::from_utf8_lossy(&request.body).contains("steer-injected-marker")),
        "steer input did not reach any model request: {requests:?}"
    );
}
