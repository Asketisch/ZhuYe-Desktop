//! 运行中的讨论必须能经桌面取消命令进入 `cancelled` 终态。
mod common;

use std::sync::mpsc::channel;
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use wiremock::matchers::{body_string_contains, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn delayed_reply() -> String {
    [
        (
            "message_start",
            json!({"type":"message_start","message":{"id":"discussion-cancel","model":"claude-mock","usage":{"input_tokens":1}}}),
        ),
        (
            "content_block_start",
            json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}),
        ),
        (
            "content_block_delta",
            json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"late"}}),
        ),
        ("content_block_stop", json!({"type":"content_block_stop","index":0})),
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

#[test]
fn cancel_discussion_stops_participant_and_emits_cancelled_terminal_event() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    let provider = runtime.block_on(async {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("ROLE_CANCEL participant"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_delay(Duration::from_secs(3))
                    .set_body_raw(delayed_reply(), "text/event-stream"),
            )
            .mount(&server)
            .await;
        server
    });
    common::set_config_before_install(&format!(
        "[active]\nprovider = \"anthropic\"\n[anthropic]\napi_key = \"test-key\"\nbase_url = \"{}\"\nmodel = \"claude-mock\"\n[hooks]\nenabled = []\n",
        provider.uri()
    ));
    let (tx, rx) = channel::<Value>();
    common::listen("reflect_event", move |event: tauri::Event| {
        if let Ok(value) = serde_json::from_str(event.payload()) {
            let _ = tx.send(value);
        }
    });
    std::fs::write(
        "discussion-cancel.toml",
        r#"[discussion]
mode = "sequential"
topic = "cancel"
max_rounds = 1
[[agents]]
role = "participant"
system_prompt = "ROLE_CANCEL participant"
"#,
    )
    .unwrap();
    let worker = std::thread::spawn(|| {
        common::invoke(
            "reflect_run_discussion",
            json!({"configPath":"discussion-cancel.toml"}),
        )
    });

    let mut events = Vec::new();
    let start_deadline = Instant::now() + Duration::from_secs(10);
    let started = loop {
        let event = rx
            .recv_timeout(start_deadline.saturating_duration_since(Instant::now()))
            .unwrap_or_else(|_| panic!("discussion start timed out: {events:#?}"));
        if event["msg"]["type"] == "collab_started" {
            break event;
        }
        events.push(event);
    };
    let cancelled_count = common::invoke_ok("reflect_cancel_discussions", json!({}));
    assert_eq!(cancelled_count, 1);

    let discussion_id = started["msg"]["id"].clone();
    let deadline = Instant::now() + Duration::from_secs(10);
    let terminal = loop {
        let event = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .unwrap_or_else(|_| {
                panic!("cancelled discussion terminal event timed out: {events:#?}")
            });
        if event["msg"]["type"] == "collab_finished" && event["msg"]["id"] == discussion_id {
            break event;
        }
        events.push(event);
    };
    let result = worker.join().unwrap();
    assert!(
        result.is_err(),
        "cancelled run must not return success: {result:?}"
    );
    assert_eq!(terminal["msg"]["outcome"], "cancelled", "{events:#?}");
}
