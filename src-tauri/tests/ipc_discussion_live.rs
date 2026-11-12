//! 消息必须在讨论仍运行时到达界面事件通道。
mod common;

use std::sync::{Arc, Condvar, Mutex, mpsc::channel};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use wiremock::matchers::{body_string_contains, method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

fn reply(tool: bool) -> String {
    let (block, delta, stop) = if tool {
        (
            json!({"type":"tool_use","id":"toolu_live","name":"send_message"}),
            json!({"type":"input_json_delta","partial_json":"{\"content\":\"first-live-message\"}"}),
            "tool_use",
        )
    } else {
        (
            json!({"type":"text","text":""}),
            json!({"type":"text_delta","text":"done"}),
            "end_turn",
        )
    };
    [
        ("message_start", json!({"type":"message_start","message":{"id":"live","model":"claude-mock","usage":{"input_tokens":1}}})),
        ("content_block_start", json!({"type":"content_block_start","index":0,"content_block":block})),
        ("content_block_delta", json!({"type":"content_block_delta","index":0,"delta":delta})),
        ("content_block_stop", json!({"type":"content_block_stop","index":0})),
        ("message_delta", json!({"type":"message_delta","delta":{"stop_reason":stop},"usage":{"output_tokens":1}})),
        ("message_stop", json!({"type":"message_stop"})),
    ].iter().map(|(name, data)| format!("event: {name}\ndata: {data}\n\n")).collect()
}

#[test]
fn first_message_is_emitted_before_the_next_participant_finishes() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    let (waiting_tx, waiting_rx) = channel();
    let release = Arc::new((Mutex::new(false), Condvar::new()));
    let release_server = release.clone();
    let provider = runtime.block_on(async {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("ROLE_FIRST"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(reply(true), "text/event-stream"))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("tool_result"))
            .respond_with(
                ResponseTemplate::new(200).set_body_raw(reply(false), "text/event-stream"),
            )
            .with_priority(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("ROLE_SLOW"))
            .respond_with(move |_: &Request| {
                let _ = waiting_tx.send(());
                let (lock, ready) = &*release_server;
                let guard = lock.lock().unwrap();
                let _guard = ready.wait_while(guard, |released| !*released).unwrap();
                ResponseTemplate::new(200).set_body_raw(reply(false), "text/event-stream")
            })
            .with_priority(1)
            .mount(&server)
            .await;
        server
    });
    common::set_config_before_install(&format!(
        "[active]\nprovider = \"anthropic\"\n[anthropic]\napi_key = \"test-key\"\nbase_url = \"{}\"\nmodel = \"claude-mock\"\n[hooks]\nenabled = []\n",
        provider.uri()
    ));
    let (events_tx, events_rx) = channel::<Value>();
    common::listen("reflect_event", move |event: tauri::Event| {
        if let Ok(value) = serde_json::from_str(event.payload()) {
            let _ = events_tx.send(value);
        }
    });
    std::fs::write(
        "discussion-live.toml",
        r#"[discussion]
mode = "sequential"
topic = "live"
max_rounds = 1
[[agents]]
role = "first"
system_prompt = "ROLE_FIRST"
[[agents]]
role = "slow"
system_prompt = "ROLE_SLOW"
"#,
    )
    .unwrap();
    let worker = std::thread::spawn(|| {
        common::invoke(
            "reflect_run_discussion",
            json!({"configPath":"discussion-live.toml"}),
        )
    });
    let reached_second = waiting_rx.recv_timeout(Duration::from_secs(30)).is_ok();
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut saw_live_message = false;
    while reached_second && Instant::now() < deadline {
        match events_rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            Ok(event)
                if event["msg"]["type"] == "collab_message"
                    && event["msg"]["content"] == "first-live-message" =>
            {
                saw_live_message = true;
                break;
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
    let (lock, ready) = &*release;
    *lock.lock().unwrap() = true;
    ready.notify_all();
    let result = worker.join().unwrap();
    assert!(
        reached_second,
        "second participant did not start: {result:?}"
    );
    assert!(result.is_ok(), "{result:?}");
    assert!(
        saw_live_message,
        "first message was withheld until the discussion ended"
    );
}
