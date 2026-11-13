//! Autopilot 的真实回合耗尽热更新的 token 预算时必须记录失败。
mod common;
use serde_json::{Value, json};
use std::time::{Duration, Instant};
use wiremock::matchers::{body_string_contains, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn tool_reply() -> String {
    [
        ("message_start", json!({"type":"message_start","message":{"id":"limit","model":"claude-mock","usage":{"input_tokens":1}}})),
        ("content_block_start", json!({"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_limit","name":"echo"}})),
        ("content_block_delta", json!({"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"text\":\"limit\"}"}})),
        ("content_block_stop", json!({"type":"content_block_stop","index":0})),
        ("message_delta", json!({"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":1}})),
        ("message_stop", json!({"type":"message_stop"})),
    ].iter().map(|(name,data)| format!("event: {name}\ndata: {data}\n\n")).collect()
}

fn text_reply() -> String {
    [
        ("message_start", json!({"type":"message_start","message":{"id":"after-reset","model":"claude-mock","usage":{"input_tokens":1}}})),
        ("content_block_start", json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}})),
        ("content_block_delta", json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"budget removed"}})),
        ("content_block_stop", json!({"type":"content_block_stop","index":0})),
        ("message_delta", json!({"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}})),
        ("message_stop", json!({"type":"message_stop"})),
    ].iter().map(|(name,data)| format!("event: {name}\ndata: {data}\n\n")).collect()
}

#[test]
fn hot_reloaded_budget_marks_autopilot_run_failed() {
    unsafe { std::env::set_var("ZHUYE_AUTOPILOT_TICK_SECS", "1") };
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap();
    let provider = runtime.block_on(async {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("budget-reset-marker"))
            .respond_with(
                ResponseTemplate::new(200).set_body_raw(text_reply(), "text/event-stream"),
            )
            .with_priority(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .respond_with(
                ResponseTemplate::new(200).set_body_raw(tool_reply(), "text/event-stream"),
            )
            .mount(&server)
            .await;
        server
    });
    common::set_config_before_install(&format!(
        "[active]\nprovider = \"anthropic\"\n[anthropic]\napi_key = \"test-key\"\nbase_url = \"{}\"\nmodel = \"claude-mock\"\n[hooks]\nenabled = []\n",
        provider.uri()
    ));
    let (tx, rx) = std::sync::mpsc::channel::<Value>();
    common::listen("reflect_event", move |event: tauri::Event| {
        if let Ok(value) = serde_json::from_str(event.payload()) {
            let _ = tx.send(value);
        }
    });
    let session = common::invoke_ok("reflect_create_session", json!({}));
    common::invoke_ok("reflect_bind_session", json!({"id":session}));
    common::invoke_ok(
        "reflect_save_config",
        json!({"toml": format!("[active]\nprovider = \"anthropic\"\n[anthropic]\napi_key = \"test-key\"\nbase_url = \"{}\"\nmodel = \"claude-mock\"\n[hooks]\nenabled = []\n[token_budget]\nsession_total_tokens = 1\n", provider.uri())}),
    );
    common::invoke_ok(
        "reflect_update_autopilot_config",
        json!({"config":{"enabled":true,"schedule":"* * * * *","taskTemplate":"limit-marker","maxConcurrent":1}}),
    );
    let config = common::isolated_home()
        .join(".zhuye/autopilot/config.json");
    std::fs::OpenOptions::new()
        .write(true)
        .open(config)
        .unwrap()
        .set_times(
            std::fs::FileTimes::new()
                .set_modified(std::time::SystemTime::now() - Duration::from_secs(120)),
        )
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(15);
    let terminal = loop {
        let event = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .expect("turn completion missing");
        if event["msg"]["type"] == "turn_complete" {
            break event;
        }
    };
    assert_eq!(
        terminal["msg"]["status"], "token_budget_exceeded",
        "{terminal}"
    );
    assert!(
        runtime
            .block_on(provider.received_requests())
            .unwrap()
            .iter()
            .any(|request| String::from_utf8_lossy(&request.body).contains("limit-marker")),
        "autopilot did not reach the local provider"
    );
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let history = common::invoke_ok("reflect_autopilot_history", json!({}));
        if history[0]["status"] == "failed" {
            assert!(
                history[0]["error"]
                    .as_str()
                    .unwrap_or_default()
                    .contains("TokenBudgetExceeded"),
                "{history}"
            );
            break;
        }
        assert!(
            Instant::now() < deadline,
            "limit was not recorded as failure: {history}"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    common::invoke_ok(
        "reflect_save_config",
        json!({"toml": format!("[active]\nprovider = \"anthropic\"\n[anthropic]\napi_key = \"test-key\"\nbase_url = \"{}\"\nmodel = \"claude-mock\"\n[hooks]\nenabled = []\n", provider.uri())}),
    );
    common::invoke_ok(
        "reflect_submit",
        json!({"submission":{"id":"budget-reset-turn","op":{"type":"user_input","items":[{"type":"text","text":"budget-reset-marker"}]}}}),
    );
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let event = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .expect("turn after budget removal missing");
        if event["id"] == "budget-reset-turn" && event["msg"]["type"] == "turn_complete" {
            assert_eq!(event["msg"]["status"], "success", "{event}");
            break;
        }
    }
    assert!(
        runtime
            .block_on(provider.received_requests())
            .unwrap()
            .iter()
            .any(|request| String::from_utf8_lossy(&request.body).contains("budget-reset-marker")),
        "budget removal did not allow the next model request"
    );
}
