//! 显式关闭 telemetry 后不得写 activity 内存或磁盘审计记录。
mod common;

use serde_json::{Value, json};
use std::sync::mpsc::{Receiver, channel};
use std::time::{Duration, Instant};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn reply() -> String {
    [
        (
            "message_start",
            json!({"type":"message_start","message":{"id":"activity-off","model":"claude-mock","usage":{"input_tokens":1}}}),
        ),
        (
            "content_block_start",
            json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}),
        ),
        (
            "content_block_delta",
            json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"done"}}),
        ),
        (
            "content_block_stop",
            json!({"type":"content_block_stop","index":0}),
        ),
        (
            "message_delta",
            json!({"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}),
        ),
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

#[test]
fn disabled_telemetry_does_not_start_activity_audit() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    let provider = runtime.block_on(async {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(reply(), "text/event-stream"))
            .mount(&server)
            .await;
        server
    });
    common::set_config_before_install(&format!(
        "[active]\nprovider = \"anthropic\"\n[anthropic]\napi_key = \"test-key\"\nbase_url = \"{}\"\nmodel = \"claude-mock\"\n[hooks]\nenabled = []\n[telemetry]\nenabled = false\n",
        provider.uri()
    ));
    let rx = listen();
    let session = common::invoke_ok("reflect_create_session", json!({}));
    common::invoke_ok("reflect_bind_session", json!({"id":session}));
    common::invoke_ok(
        "reflect_submit",
        json!({"submission":{"id":"activity-off-turn","op":{"type":"user_input","items":[{"type":"text","text":"activity-off-marker"}]}}}),
    );
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let event = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .expect("activity-off turn did not finish");
        if event["id"] == "activity-off-turn" && event["msg"]["type"] == "turn_complete" {
            break;
        }
    }
    std::thread::sleep(Duration::from_millis(100));
    assert_eq!(common::invoke_ok("reflect_activity_count", json!({})), 0);
    assert_eq!(
        common::invoke_ok("reflect_list_activity", json!({})),
        json!([])
    );
    assert!(
        !common::isolated_home()
            .join(".zhuye/activity/activity.jsonl")
            .exists(),
        "disabled activity audit wrote a disk file"
    );
}
