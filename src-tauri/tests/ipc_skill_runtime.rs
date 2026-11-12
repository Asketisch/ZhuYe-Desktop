//! 重扫发现的 Skill 必须能由模型加载，正文和激活工具返回模型。
mod common;

use serde_json::{Value, json};
use std::sync::mpsc::{Receiver, channel};
use std::time::{Duration, Instant};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

fn stream(tool: bool) -> String {
    let (block, delta, stop) = if tool {
        (
            json!({"type":"tool_use","id":"skill_runtime_tool","name":"load_skill"}),
            json!({"type":"input_json_delta","partial_json":"{\"name\":\"runtime-skill\"}"}),
            "tool_use",
        )
    } else {
        (
            json!({"type":"text","text":""}),
            json!({"type":"text_delta","text":"skill loaded"}),
            "end_turn",
        )
    };
    [
        (
            "message_start",
            json!({"type":"message_start","message":{"id":"skill-runtime","model":"claude-mock","usage":{"input_tokens":5}}}),
        ),
        (
            "content_block_start",
            json!({"type":"content_block_start","index":0,"content_block":block}),
        ),
        (
            "content_block_delta",
            json!({"type":"content_block_delta","index":0,"delta":delta}),
        ),
        (
            "content_block_stop",
            json!({"type":"content_block_stop","index":0}),
        ),
        (
            "message_delta",
            json!({"type":"message_delta","delta":{"stop_reason":stop},"usage":{"output_tokens":5}}),
        ),
        ("message_stop", json!({"type":"message_stop"})),
    ]
    .iter()
    .map(|(name, data)| format!("event: {name}\ndata: {data}\n\n"))
    .collect()
}

fn wait_for_rescan(rx: &Receiver<Value>) {
    let id = common::invoke_ok(
        "reflect_rescan_extensions",
        json!({"skills":true,"commands":true}),
    );
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let event = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .expect("rescan event missing");
        if event["id"] == id && event["msg"]["type"] == "extensions_rescanned" {
            assert_eq!(event["msg"]["skills"], 1, "{event}");
            return;
        }
    }
}

#[test]
fn model_loads_a_rescanned_skill_and_receives_its_body() {
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
                let payload = if body.contains("skill_runtime_tool") && body.contains("tool_result")
                {
                    stream(false)
                } else {
                    stream(true)
                };
                ResponseTemplate::new(200).set_body_raw(payload, "text/event-stream")
            })
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
    let skill = reflect_config::paths::data_path_or_relative(&["skills", "runtime-skill"]);
    std::fs::create_dir_all(&skill).unwrap();
    std::fs::write(
        skill.join("SKILL.md"),
        "---\nname: runtime-skill\ndescription: Runtime load probe\n---\nskill-body-marker\n",
    )
    .unwrap();
    wait_for_rescan(&rx);
    let listed = common::invoke_ok("reflect_list_skills", json!({}));
    assert!(
        listed
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["name"] == "runtime-skill"),
        "{listed}"
    );

    common::invoke_ok(
        "reflect_submit",
        json!({"submission":{"id":"skill-runtime-turn","op":{"type":"user_input","items":[{"type":"text","text":"load-runtime-skill"}]}}}),
    );
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut seen = Vec::new();
    loop {
        let event = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .unwrap_or_else(|_| panic!("skill turn timed out: {seen:#?}"));
        if event["id"] == "skill-runtime-turn" && event["msg"]["type"] == "turn_complete" {
            break;
        }
        if event["id"] == "skill-runtime-turn" && event["msg"]["type"] == "approval_request" {
            assert_eq!(event["msg"]["kind"]["tool_name"], "load_skill");
            assert!(!seen.iter().any(|prior: &Value| {
                prior["msg"]["type"] == "tool_call_end"
                    && prior["msg"]["call_id"] == "skill_runtime_tool"
            }));
            common::invoke_ok(
                "reflect_tool_approval",
                json!({"id":event["msg"]["request_id"],"decision":"approve"}),
            );
        }
        seen.push(event);
    }
    let call = seen
        .iter()
        .find(|event| {
            event["msg"]["type"] == "tool_call_end"
                && event["msg"]["call_id"] == "skill_runtime_tool"
        })
        .expect("load_skill result missing");
    assert_eq!(call["msg"]["is_error"], false, "{call}");
    assert!(call.to_string().contains("skill-body-marker"), "{call}");

    let requests = runtime.block_on(provider.received_requests()).unwrap();
    assert_eq!(requests.len(), 2);
    let second: Value = serde_json::from_slice(&requests[1].body).unwrap();
    assert!(
        second.to_string().contains("skill-body-marker"),
        "Skill body did not return to the model: {second}"
    );
    std::fs::remove_dir_all(skill).unwrap();
}
