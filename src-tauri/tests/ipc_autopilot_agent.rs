//! Autopilot 指定 agent 时经引擎 side-channel 真跑并回填历史。
mod common;

use std::time::{Duration, Instant};

use serde_json::{Value, json};
use wiremock::matchers::{body_string_contains, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn reply() -> String {
    [
        (
            "message_start",
            json!({"type":"message_start","message":{"id":"autopilot-agent-message","model":"claude-mock","usage":{"input_tokens":10}}}),
        ),
        (
            "content_block_start",
            json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}),
        ),
        (
            "content_block_delta",
            json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"selected agent complete"}}),
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
fn selected_agent_runs_in_side_channel_and_finalizes_history() {
    unsafe { std::env::set_var("ZHUYE_AUTOPILOT_TICK_SECS", "1") };
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    let provider = runtime.block_on(async {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("autopilot-selected-agent-marker"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_delay(Duration::from_secs(8))
                    .set_body_raw(reply(), "text/event-stream"),
            )
            .with_priority(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(reply(), "text/event-stream"))
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
    let agent_dir = std::path::Path::new(".zhuye/agents");
    std::fs::create_dir_all(agent_dir).unwrap();
    std::fs::write(
        agent_dir.join("autopilot-runner.md"),
        "---\nname: autopilot-runner\ndescription: Autopilot runtime fixture\nspawnable: true\n---\nAUTOPILOT_AGENT_SYSTEM_MARKER\n",
    )
    .unwrap();
    let session = common::invoke_ok("reflect_create_session", json!({}));
    common::invoke_ok("reflect_bind_session", json!({"id":session}));
    common::invoke_ok(
        "reflect_update_autopilot_config",
        json!({"config":{
            "enabled": true,
            "schedule": "* * * * *",
            "taskTemplate": "autopilot-selected-agent-marker",
            "agent": "autopilot-runner",
            "maxConcurrent": 1
        }}),
    );
    let config_path = dirs::home_dir()
        .unwrap()
        .join(".zhuye/autopilot/config.json");
    let old = std::time::SystemTime::now() - Duration::from_secs(120);
    std::fs::OpenOptions::new()
        .write(true)
        .open(&config_path)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(old))
        .unwrap();

    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let requests = runtime.block_on(provider.received_requests()).unwrap();
        if requests
            .iter()
            .any(|r| String::from_utf8_lossy(&r.body).contains("autopilot-selected-agent-marker"))
        {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "selected agent did not reach provider"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    common::invoke_ok(
        "reflect_submit",
        json!({"submission":{"id":"unrelated-turn","op":{"type":"user_input","items":[{"type":"text","text":"unrelated manual chat"}]}}}),
    );
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let event = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .expect("unrelated turn did not finish");
        if event["id"] == "unrelated-turn" && event["msg"]["type"] == "turn_complete" {
            break;
        }
    }
    let pending = common::invoke_ok("reflect_autopilot_history", json!({}));
    assert_eq!(
        pending[0]["status"], "inProgress",
        "unrelated turn must not finalize autopilot: {pending}"
    );

    let first_id = pending[0]["id"].as_str().unwrap().to_owned();
    let history_path = dirs::home_dir()
        .unwrap()
        .join(".zhuye/autopilot/history.json");
    let mut seeded = pending;
    seeded[0]["executedAtMs"] = json!(
        old.duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
    );
    std::fs::write(&history_path, serde_json::to_vec_pretty(&seeded).unwrap()).unwrap();
    common::invoke_ok(
        "reflect_update_autopilot_config",
        json!({"config":{
            "enabled":true,"schedule":"* * * * *","taskTemplate":"autopilot-concurrent-fast-marker",
            "agent":"autopilot-runner","maxConcurrent":2
        }}),
    );
    let deadline = Instant::now() + Duration::from_secs(6);
    let fast_id = loop {
        let history = common::invoke_ok("reflect_autopilot_history", json!({}));
        if let Some(run) = history.as_array().unwrap().iter().find(|run| {
            run["id"].as_str().is_some_and(|id| id != first_id) && run["status"] == "success"
        }) {
            let first = history
                .as_array()
                .unwrap()
                .iter()
                .find(|run| run["id"] == first_id)
                .unwrap();
            assert_eq!(
                first["status"], "inProgress",
                "fast run finished the slow run: {history}"
            );
            break run["id"].as_str().unwrap().to_owned();
        }
        assert!(
            Instant::now() < deadline,
            "concurrent fast run did not complete: {history}"
        );
        std::thread::sleep(Duration::from_millis(20));
    };
    let deadline = Instant::now() + Duration::from_secs(15);
    let history = loop {
        let history = common::invoke_ok("reflect_autopilot_history", json!({}));
        if history.as_array().is_some_and(|runs| {
            runs.iter()
                .any(|run| run["id"] == first_id && run["status"] == "success")
        }) {
            break history;
        }
        assert!(
            Instant::now() < deadline,
            "selected-agent autopilot did not finish: {history}"
        );
        std::thread::sleep(Duration::from_millis(50));
    };
    common::invoke_ok(
        "reflect_update_autopilot_config",
        json!({"config":{
            "enabled": false,
            "schedule": "* * * * *",
            "taskTemplate": "disabled",
            "agent": "autopilot-runner",
            "maxConcurrent": 1
        }}),
    );
    let requests = runtime.block_on(provider.received_requests()).unwrap();
    let request = requests
        .iter()
        .find(|request| {
            let body = String::from_utf8_lossy(&request.body);
            body.contains("AUTOPILOT_AGENT_SYSTEM_MARKER")
                && body.contains("autopilot-selected-agent-marker")
        })
        .expect("selected autopilot agent definition was not applied");
    let body: Value = serde_json::from_slice(&request.body).unwrap();
    assert_eq!(body["messages"][0]["role"], "user");
    assert!(
        history
            .as_array()
            .is_some_and(|runs| runs.iter().any(|run| run["status"] == "success")),
        "{history}"
    );

    let mut saw_side_channel = false;
    while let Ok(event) = rx.try_recv() {
        if event["msg"]["type"] == "side_channel_finished" && event["msg"]["kind"] == "done" {
            saw_side_channel = true;
        }
    }
    assert!(
        saw_side_channel,
        "selected agent did not emit side-channel terminal"
    );

    assert!(
        history
            .as_array()
            .unwrap()
            .iter()
            .any(|run| run["id"] == fast_id && run["status"] == "success")
    );
    let requests = runtime.block_on(provider.received_requests()).unwrap();
    assert!(requests.iter().any(|request| {
        String::from_utf8_lossy(&request.body).contains("autopilot-concurrent-fast-marker")
    }));
}
