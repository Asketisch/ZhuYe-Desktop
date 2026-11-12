//! 本地模型驱动真实讨论，验证角色身份、消息和事件。
mod common;

use std::sync::mpsc::channel;
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use wiremock::matchers::{body_string_contains, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn reply(role: Option<&str>) -> String {
    let (block, delta, stop) = match role {
        Some(role) => (
            json!({"type":"tool_use", "id": format!("toolu_{role}"), "name":"send_message"}),
            json!({"type":"input_json_delta", "partial_json": json!({"content": format!("message-from-{role}")}).to_string()}),
            "tool_use",
        ),
        None => (
            json!({"type":"text", "text":""}),
            json!({"type":"text_delta", "text":"message sent"}),
            "end_turn",
        ),
    };
    [
        ("message_start", json!({"type":"message_start", "message":{"id":"discussion-message", "model":"claude-mock", "usage":{"input_tokens":10}}})),
        ("content_block_start", json!({"type":"content_block_start", "index":0, "content_block":block})),
        ("content_block_delta", json!({"type":"content_block_delta", "index":0, "delta":delta})),
        ("content_block_stop", json!({"type":"content_block_stop", "index":0})),
        ("message_delta", json!({"type":"message_delta", "delta":{"stop_reason":stop}, "usage":{"output_tokens":5}})),
        ("message_stop", json!({"type":"message_stop"})),
    ].iter().map(|(name, data)| format!("event: {name}\ndata: {data}\n\n")).collect()
}

#[test]
fn discussion_preserves_each_participants_identity_in_transcript_and_events() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap();
    let provider = runtime.block_on(async {
        let server = MockServer::start().await;
        for (marker, role) in [("ROLE_ADVOCATE", "advocate"), ("ROLE_SKEPTIC", "skeptic")] {
            Mock::given(method("POST"))
                .and(path("/v1/messages"))
                .and(body_string_contains(marker))
                .respond_with(
                    ResponseTemplate::new(200).set_body_raw(reply(Some(role)), "text/event-stream"),
                )
                .mount(&server)
                .await;
        }
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("tool_result"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(reply(None), "text/event-stream"))
            .with_priority(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("ROLE_PROVIDER_FAILURE"))
            .respond_with(
                ResponseTemplate::new(401).set_body_string("fixture authentication failure"),
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
    let session = common::invoke_ok("reflect_create_session", json!({}));
    common::invoke_ok("reflect_bind_session", json!({"id":session}));
    let config = r#"[discussion]
mode = "sequential"
topic = "identity test"
max_rounds = 1
consensus_window = 1
[[agents]]
role = "advocate"
system_prompt = "ROLE_ADVOCATE"
allowed_tools = ["send_message"]
[[agents]]
role = "skeptic"
system_prompt = "ROLE_SKEPTIC"
allowed_tools = ["send_message"]
"#;
    for mode in ["sequential", "concurrent"] {
        let config = config.replace("mode = \"sequential\"", &format!("mode = \"{mode}\""));
        std::fs::write("discussion-runtime.toml", config).unwrap();
        let outcome = common::invoke_ok(
            "reflect_run_discussion",
            json!({ "configPath": "discussion-runtime.toml" }),
        );
        assert_eq!(outcome["llmBacked"], true, "{outcome}");
        let transcript = outcome["transcript"].as_str().unwrap();
        assert!(
            transcript.contains("advocate: message-from-advocate"),
            "{mode}: {transcript}"
        );
        assert!(
            transcript.contains("skeptic: message-from-skeptic"),
            "{mode}: {transcript}"
        );
        let mut events = Vec::new();
        let deadline = Instant::now() + Duration::from_secs(10);
        while !events.iter().any(|event: &Value| {
            event["msg"]["type"] == "collab_finished"
                && event["msg"]["id"] == outcome["discussionId"]
        }) {
            events.push(
                rx.recv_timeout(deadline.saturating_duration_since(Instant::now()))
                    .unwrap_or_else(|_| panic!("discussion events timed out: {events:#?}")),
            );
        }
        for role in ["advocate", "skeptic"] {
            assert!(
                events
                    .iter()
                    .any(|event| event["msg"]["type"] == "collab_message"
                        && event["msg"]["id"] == outcome["discussionId"]
                        && event["msg"]["from"] == role
                        && event["msg"]["content"] == format!("message-from-{role}")),
                "{events:#?}"
            );
        }
        let replay = common::invoke_ok("reflect_replay_session", json!({"id":session}));
        let replay_text = replay.to_string();
        assert!(
            replay_text.contains(outcome["discussionId"].as_str().unwrap_or_default())
                && replay_text.contains("message-from-advocate")
                && replay_text.contains("message-from-skeptic"),
            "{mode}: {replay}"
        );
        let history = common::invoke_ok(
            "reflect_list_discussions",
            json!({"discussionId":outcome["discussionId"]}),
        );
        eprintln!("discussion history: {history}");
        assert!(
            history
                .as_array()
                .is_some_and(|sessions| sessions.iter().any(|entry| entry["sessionId"] == session)),
            "{mode}: {history}"
        );
    }
    let failed_config = config.replace("ROLE_ADVOCATE", "ROLE_PROVIDER_FAILURE");
    std::fs::write("discussion-failure.toml", failed_config).unwrap();
    let failure = common::invoke(
        "reflect_run_discussion",
        json!({ "configPath": "discussion-failure.toml" }),
    );
    assert!(
        failure.is_err(),
        "provider failure must not be reported as a successful discussion: {failure:?}"
    );
}
