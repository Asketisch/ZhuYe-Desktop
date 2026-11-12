//! 目标模式真实回合、模型校验及验证命令的 AND 语义。
#![cfg(unix)]
mod common;

use std::sync::mpsc::{Receiver, channel};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use wiremock::matchers::{body_string_contains, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn response(structured: bool) -> String {
    let block = if structured {
        json!({ "type": "tool_use", "id": "goal-verdict", "name": "structured_output" })
    } else {
        json!({ "type": "text", "text": "" })
    };
    let delta = if structured {
        json!({ "type": "input_json_delta", "partial_json":
            r#"{"verdict":"met","evidence":["fixture evidence"]}"# })
    } else {
        json!({ "type": "text_delta", "text": "fixture work completed" })
    };
    [
        (
            "message_start",
            json!({ "type": "message_start", "message": {
                "id": "goal-message", "model": "claude-mock", "usage": { "input_tokens": 10 }
            }}),
        ),
        (
            "content_block_start",
            json!({ "type": "content_block_start", "index": 0, "content_block": block }),
        ),
        (
            "content_block_delta",
            json!({ "type": "content_block_delta", "index": 0, "delta": delta }),
        ),
        (
            "content_block_stop",
            json!({ "type": "content_block_stop", "index": 0 }),
        ),
        (
            "message_delta",
            json!({ "type": "message_delta",
            "delta": { "stop_reason": if structured { "tool_use" } else { "end_turn" } },
            "usage": { "output_tokens": 5 } }),
        ),
        ("message_stop", json!({ "type": "message_stop" })),
    ]
    .iter()
    .map(|(name, data)| format!("event: {name}\ndata: {data}\n\n"))
    .collect()
}

fn wait_snapshot(pred: impl Fn(&Value) -> bool) -> Value {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let snapshot = common::invoke_ok("reflect_goal_snapshot", json!({}));
        if pred(&snapshot) {
            return snapshot;
        }
        assert!(Instant::now() < deadline, "目标快照超时: {snapshot}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn wait_turn(rx: &Receiver<Value>, id: &str) {
    let deadline = Instant::now() + Duration::from_secs(60);
    while let Ok(event) = rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
        if event["id"] == id && event["msg"]["type"] == "turn_complete" {
            return;
        }
        assert!(
            event["id"] != id || event["msg"]["type"] != "error",
            "{event}"
        );
    }
    panic!("目标回合 {id} 未结束");
}

#[test]
fn goal_verification_requires_both_model_verdict_and_command() {
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
                    .and(body_string_contains("goal-runtime-turn"))
                    .respond_with(
                        ResponseTemplate::new(200)
                            .set_body_raw(response(false), "text/event-stream"),
                    ),
            )
            .await;
        server
            .register(
                Mock::given(method("POST"))
                    .and(path("/v1/messages"))
                    .and(body_string_contains("Judge whether the goal above"))
                    .respond_with(
                        ResponseTemplate::new(200)
                            .set_body_raw(response(true), "text/event-stream"),
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
    std::fs::write("goal-evidence.txt", "fixture").unwrap();
    for (index, command, expected_passed) in [
        (1, "false", false),
        (
            2,
            "test -f goal-evidence.txt && printf verified > goal-verified.txt",
            true,
        ),
    ] {
        let goal = format!("runtime goal {index}");
        common::invoke_ok(
            "reflect_enter_goal_mode",
            json!({
                "goal": goal, "verifyCommand": command, "tokenBudget": 10_000
            }),
        );
        wait_snapshot(|snapshot| snapshot["goal"] == goal && snapshot["status"] == "active");
        let id = format!("goal-submission-{index}");
        common::invoke_ok(
            "reflect_submit",
            json!({
                "submission": { "id": id, "op": { "type": "user_input",
                    "items": [{ "type": "text", "text": "goal-runtime-turn" }] } }
            }),
        );
        wait_turn(&rx, &id);
        if expected_passed {
            // 成功终态在上游会清除快照；验证命令留下的文件证明它实际运行。
            wait_snapshot(Value::is_null);
            assert_eq!(
                std::fs::read_to_string("goal-verified.txt").unwrap(),
                "verified"
            );
        } else {
            let snapshot = wait_snapshot(|snapshot| snapshot["turn_count"] == 1);
            assert_eq!(snapshot["status"], "active", "{snapshot}");
            assert_eq!(snapshot["turns"][0]["verdict"]["verdict"], "met");
            assert_eq!(snapshot["turns"][0]["command_passed"], false);
            assert_eq!(
                snapshot["turns"][0]["verdict"]["evidence"][0],
                "fixture evidence"
            );
            assert!(snapshot["tokens_used"].as_u64().unwrap() > 0);
        }
        common::invoke_ok("reflect_exit_goal_mode", json!({}));
        wait_snapshot(Value::is_null);
    }
    let requests = runtime.block_on(provider.received_requests()).unwrap();
    assert_eq!(requests.len(), 4, "两轮各需工作和验证模型请求");
}
