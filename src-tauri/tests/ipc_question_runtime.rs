//! 本地模型发起结构化问题，真实 IPC 回执后模型收到原样选择。
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

fn question_reply() -> String {
    let args = json!({ "questions": [
        { "header": "Database", "question": "Which database?", "multi_select": false,
          "options": [{ "label": "Postgres", "description": "relational" },
                      { "label": "Mongo", "description": "document" }] },
        { "header": "Features", "question": "Which features?", "multi_select": true,
          "options": [{ "label": "Auth", "description": "authentication" },
                      { "label": "Audit", "description": "audit log" },
                      { "label": "Cache", "description": "caching" }] }
    ]});
    sse(&[
        (
            "message_start",
            json!({ "type": "message_start", "message": {
                "id": "msg-question", "model": "claude-mock", "usage": { "input_tokens": 10 }
            }}),
        ),
        (
            "content_block_start",
            json!({ "type": "content_block_start", "index": 0,
                "content_block": { "type": "tool_use", "id": "toolu_question", "name": "ask_user_question" }
            }),
        ),
        (
            "content_block_delta",
            json!({ "type": "content_block_delta", "index": 0,
                "delta": { "type": "input_json_delta", "partial_json": args.to_string() }
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
                "id": "msg-question-done", "model": "claude-mock", "usage": { "input_tokens": 10 }
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
                "delta": { "type": "text_delta", "text": "question roundtrip complete" }
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
fn selected_and_custom_answers_return_to_model() {
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
                    .and(body_string_contains("mock-question-turn"))
                    .respond_with(
                        ResponseTemplate::new(200)
                            .set_body_raw(question_reply(), "text/event-stream"),
                    ),
            )
            .await;
        server
            .register(
                Mock::given(method("POST"))
                    .and(path("/v1/messages"))
                    .and(body_string_contains("toolu_question"))
                    .and(body_string_contains("tool_result"))
                    .and(body_string_contains("custom-verified"))
                    .respond_with(
                        ResponseTemplate::new(200).set_body_raw(final_reply(), "text/event-stream"),
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
    common::invoke_ok(
        "reflect_submit",
        json!({
            "submission": { "id": "question-submission", "op": { "type": "user_input",
                "items": [{ "type": "text", "text": "mock-question-turn" }] } }
        }),
    );
    let mut seen = Vec::new();
    let question = wait_for(&rx, &mut seen, |event| {
        event["id"] == "question-submission" && event["msg"]["type"] == "ask_user_question"
    });
    assert_eq!(question["msg"]["questions"][0]["multi_select"], false);
    assert_eq!(question["msg"]["questions"][1]["multi_select"], true);
    let id = question["msg"]["request_id"].as_str().unwrap();
    assert!(
        common::invoke(
            "reflect_ask_user_question_response",
            json!({
                "id": id, "answers": { "answers": [{ "selected": ["invalid"] }] }
            })
        )
        .is_err(),
        "非法选项必须被 IPC 拒绝"
    );
    assert_eq!(
        runtime
            .block_on(provider.received_requests())
            .unwrap()
            .len(),
        1
    );
    common::invoke_ok(
        "reflect_ask_user_question_response",
        json!({
            "id": id,
            "answers": { "answers": [
                { "selected": [1] },
                { "selected": [0, 2], "custom": "custom-verified" }
            ] }
        }),
    );
    wait_for(&rx, &mut seen, |event| {
        event["id"] == "question-submission" && event["msg"]["type"] == "turn_complete"
    });
    assert!(seen.iter().any(|event| event["id"] == "question-submission"
        && event["msg"]["type"] == "agent_message_delta"
        && event["msg"]["delta"] == "question roundtrip complete"));
    let requests = runtime.block_on(provider.received_requests()).unwrap();
    assert_eq!(requests.len(), 2);
    let body: Value = serde_json::from_slice(&requests[1].body).unwrap();
    let result = body["messages"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|message| message["content"].as_array())
        .flatten()
        .find(|block| block["type"] == "tool_result" && block["tool_use_id"] == "toolu_question")
        .expect("模型请求缺少问题工具结果");
    assert_eq!(result["is_error"], false, "{result}");
    let text = result["content"][0]["text"].as_str().unwrap();
    let answer: Value = serde_json::from_str(text).unwrap();
    assert_eq!(
        answer,
        json!({ "answers": [
        { "selected": [1] },
        { "selected": [0, 2], "custom": "custom-verified" }
    ] })
    );
}
