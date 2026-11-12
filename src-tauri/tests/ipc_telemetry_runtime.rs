//! 真实模型回合必须产生 activity、trace 与 span 审计记录。
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
            json!({"type":"message_start","message":{"id":"telemetry-runtime","model":"claude-mock","usage":{"input_tokens":11}}}),
        ),
        (
            "content_block_start",
            json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}),
        ),
        (
            "content_block_delta",
            json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"telemetry complete"}}),
        ),
        (
            "content_block_stop",
            json!({"type":"content_block_stop","index":0}),
        ),
        (
            "message_delta",
            json!({"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}),
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

fn wait_terminal(rx: &Receiver<Value>) {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let event = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .expect("telemetry turn did not finish");
        if event["id"] == "telemetry-runtime-turn" && event["msg"]["type"] == "turn_complete" {
            return;
        }
    }
}

fn wait_for<T: serde::de::DeserializeOwned>(
    command: &str,
    body: Value,
    accept: impl Fn(&T) -> bool,
) -> T {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let value = common::invoke_ok(command, body.clone());
        let parsed = serde_json::from_value(value).unwrap();
        if accept(&parsed) {
            return parsed;
        }
        assert!(
            Instant::now() < deadline,
            "{command} did not produce records"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn model_turn_writes_activity_trace_and_span_records() {
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
        "[active]\nprovider = \"anthropic\"\n[anthropic]\napi_key = \"test-key\"\nbase_url = \"{}\"\nmodel = \"claude-mock\"\n[hooks]\nenabled = []\n[telemetry]\nenabled = true\n",
        provider.uri()
    ));
    let rx = listen();
    let session = common::invoke_ok("reflect_create_session", json!({}));
    common::invoke_ok("reflect_bind_session", json!({"id":session}));
    common::invoke_ok(
        "reflect_submit",
        json!({"submission":{"id":"telemetry-runtime-turn","op":{"type":"user_input","items":[{"type":"text","text":"telemetry-runtime-marker"}]}}}),
    );
    wait_terminal(&rx);

    let traces: Vec<Value> = wait_for(
        "reflect_list_traces",
        json!({"limit":5}),
        |traces: &Vec<Value>| {
            traces.iter().any(|trace| {
                trace["sessionId"] == session && trace["calls"].as_u64().unwrap_or(0) > 0
            })
        },
    );
    let trace = traces
        .iter()
        .find(|trace| trace["sessionId"] == session)
        .unwrap();
    assert_eq!(trace["lastSource"], "main_turn", "{trace}");
    assert_eq!(trace["model"], "claude-mock", "{trace}");

    let files: Vec<Value> = wait_for(
        "reflect_list_span_logs",
        json!({"days":1}),
        |files: &Vec<Value>| !files.is_empty(),
    );
    let day = files[0]["day"].as_str().unwrap();
    let spans: Vec<Value> = wait_for(
        "reflect_read_span_log",
        json!({"day":day,"sessionId":session}),
        |spans: &Vec<Value>| {
            spans.iter().any(|span| span["event"] == "turn.started")
                && spans
                    .iter()
                    .any(|span| span["event"] == "model.request.completed")
        },
    );
    assert!(
        spans.iter().any(|span| span["event"] == "turn.completed"),
        "{spans:?}"
    );

    let activity: Vec<Value> =
        wait_for("reflect_list_activity", json!({}), |events: &Vec<Value>| {
            events.iter().any(|event| event["kind"] == "turn_complete")
        });
    assert!(
        activity.iter().any(|event| event["kind"] == "turn_started"),
        "{activity:?}"
    );
    let audit = dirs::home_dir()
        .unwrap()
        .join(".zhuye/activity/activity.jsonl");
    assert!(audit.exists(), "activity audit file missing: {audit:?}");
    let disk = std::fs::read_to_string(audit).unwrap();
    assert!(
        disk.contains("turn_complete"),
        "activity audit content missing: {disk}"
    );
    assert!(
        runtime
            .block_on(provider.received_requests())
            .unwrap()
            .len()
            == 1
    );
}
