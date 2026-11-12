//! Team pipeline runs four real model-backed nodes through IPC.
#![cfg(unix)]
mod common;

use serde_json::{Value, json};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn reply() -> String {
    [
        (
            "message_start",
            json!({"type":"message_start","message":{"id":"team-pipeline-message","model":"claude-mock","usage":{"input_tokens":10}}}),
        ),
        (
            "content_block_start",
            json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}),
        ),
        (
            "content_block_delta",
            json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"team-node-complete"}}),
        ),
        ("content_block_stop", json!({"type":"content_block_stop","index":0})),
        (
            "message_delta",
            json!({"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}),
        ),
        ("message_stop", json!({"type":"message_stop"})),
    ]
        .iter()
        .map(|(name, data)| format!("event: {name}\ndata: {data}\n\n"))
        .collect()
}

#[test]
fn team_pipeline_runs_four_nodes_with_local_model() {
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
        r#"[active]
provider = "anthropic"
[anthropic]
api_key = "test-key"
base_url = "{}"
model = "claude-mock"
[hooks]
enabled = []
"#,
        provider.uri()
    ));
    let team = json!({
        "name": "rocket",
        "description": "local-model team pipeline",
        "lead_agent_id": "team-lead@rocket",
        "members": [{
            "agent_id": "team-lead@rocket",
            "name": "team-lead",
            "role": "team-lead",
            "model": null,
            "system_prompt": "Complete the assigned pipeline stage concisely.",
            "allowed_tools": [],
            "joined_at": {"secs_since_epoch": 1700000000u64, "nanos_since_epoch": 0u32}
        }],
        "created_at": {"secs_since_epoch": 1700000000u64, "nanos_since_epoch": 0u32}
    });
    common::invoke_ok("reflect_upsert_team", json!({ "team": team }));
    let report = common::invoke_ok(
        "reflect_run_team_pipeline",
        json!({ "teamName": "rocket", "topic": "team pipeline runtime check" }),
    );
    assert_eq!(report["status"], "success", "{report}");
    let nodes = report["nodes"].as_array().unwrap();
    let names: Vec<_> = nodes
        .iter()
        .map(|node| node["name"].as_str().unwrap_or_default())
        .collect();
    assert_eq!(names, ["plan", "prd", "exec", "verify"], "{report}");
    assert!(
        nodes.iter().all(|node| {
            node["status"] == "success"
                && node["outputs"]["result"]
                    .as_str()
                    .is_some_and(|text| text.contains("team-node-complete"))
        }),
        "{report}"
    );
    let requests = runtime.block_on(provider.received_requests()).unwrap();
    assert_eq!(requests.len(), 4, "one model request per pipeline node");
    for request in &requests {
        let body: Value = serde_json::from_slice(&request.body).unwrap();
        assert_eq!(body["messages"][0]["role"], "user");
    }
}
