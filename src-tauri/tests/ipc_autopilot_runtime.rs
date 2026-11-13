//! Autopilot 经真实 AgentThread、本地模型与历史文件完成闭环。
mod common;

use std::sync::mpsc::channel;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use wiremock::matchers::{body_string_contains, method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

fn reply() -> String {
    [
        (
            "message_start",
            json!({ "type": "message_start", "message": {
                "id": "autopilot-message", "model": "claude-mock", "usage": { "input_tokens": 10 }
            }}),
        ),
        (
            "content_block_start",
            json!({ "type": "content_block_start", "index": 0,
                "content_block": { "type": "text", "text": "" } }),
        ),
        (
            "content_block_delta",
            json!({ "type": "content_block_delta", "index": 0,
                "delta": { "type": "text_delta", "text": "autopilot complete" } }),
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
    ]
    .iter()
    .map(|(name, data)| format!("event: {name}\ndata: {data}\n\n"))
    .collect()
}

fn wait_history_success(events_rx: &std::sync::mpsc::Receiver<Value>) -> Value {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let history = common::invoke_ok("reflect_autopilot_history", json!({}));
        assert!(history.is_array(), "{history}");
        if history
            .as_array()
            .unwrap()
            .iter()
            .any(|run| run["status"] == "success")
        {
            return history;
        }
        if Instant::now() >= deadline {
            let mut observed = Vec::new();
            while let Ok(event) = events_rx.try_recv() {
                observed.push(event);
            }
            panic!("autopilot did not finish: {history}; events: {observed:#?}");
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn wait_history_success_count(minimum: usize) -> Value {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let history = common::invoke_ok("reflect_autopilot_history", json!({}));
        let count = history
            .as_array()
            .map(|runs| runs.iter().filter(|run| run["status"] == "success").count())
            .unwrap_or_default();
        if count >= minimum {
            return history;
        }
        if Instant::now() >= deadline {
            panic!("expected at least {minimum} successful autopilot runs: {history}");
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn force_next_due() {
    let root = common::isolated_home().join(".zhuye/autopilot");
    let config_path = root.join("config.json");
    let history_path = root.join("history.json");
    let old = std::time::SystemTime::now() - Duration::from_secs(120);
    let mut history = common::invoke_ok("reflect_autopilot_history", json!({}));
    if let Some(runs) = history.as_array_mut()
        && let Some(first) = runs.first_mut()
    {
        first["executedAtMs"] = json!(
            old.duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64
        );
        std::fs::write(&history_path, serde_json::to_vec_pretty(&history).unwrap()).unwrap();
    } else {
        std::fs::OpenOptions::new()
            .write(true)
            .open(&config_path)
            .unwrap()
            .set_times(std::fs::FileTimes::new().set_modified(old))
            .unwrap();
    }
}

fn wait_for_failure_reason(_events_rx: &std::sync::mpsc::Receiver<Value>, reason: &str) -> Value {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let history = common::invoke_ok("reflect_autopilot_history", json!({}));
        if let Some(run) = history.as_array().and_then(|runs| {
            runs.iter()
                .find(|run| run["status"] == "failed" && run["error"].as_str() == Some(reason))
        }) {
            return run.clone();
        }
        if Instant::now() >= deadline {
            panic!("autopilot cancellation was not recorded as {reason:?}: {history}");
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn wait_for_provider_failure(_events_rx: &std::sync::mpsc::Receiver<Value>) -> Value {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let history = common::invoke_ok("reflect_autopilot_history", json!({}));
        if let Some(run) = history.as_array().and_then(|runs| {
            runs.iter().find(|run| {
                run["status"] == "failed"
                    && run["error"]
                        .as_str()
                        .is_some_and(|error| error.contains("exhausted"))
            })
        }) {
            return run.clone();
        }
        if Instant::now() >= deadline {
            panic!("provider failure was not recorded: {history}");
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn autopilot_submits_due_task_and_finalizes_history() {
    // 驱动在 harness 安装时读取 tick；此时测试进程尚未创建并发线程。
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
    let (events_tx, events_rx) = channel::<Value>();
    common::listen("reflect_event", move |event: tauri::Event| {
        if let Ok(value) = serde_json::from_str(event.payload()) {
            let _ = events_tx.send(value);
        }
    });
    let session = common::invoke_ok("reflect_create_session", json!({}));
    common::invoke_ok("reflect_bind_session", json!({"id":session}));
    common::invoke_ok(
        "reflect_update_autopilot_config",
        json!({"config":{
            "enabled": true,
            "schedule": "* * * * *",
            "taskTemplate": "autopilot-runtime-marker",
            "maxConcurrent": 1
        }}),
    );

    force_next_due();

    let history = wait_history_success(&events_rx);
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut saw_completion = false;
    while let Ok(event) = events_rx.recv_timeout(deadline.saturating_duration_since(Instant::now()))
    {
        if event["msg"]["type"] == "turn_complete" && event["msg"]["status"] == "success" {
            saw_completion = true;
            break;
        }
    }
    assert!(saw_completion, "autopilot turn did not complete");
    let requests = runtime.block_on(provider.received_requests()).unwrap();
    let request = requests
        .iter()
        .find(|request| String::from_utf8_lossy(&request.body).contains("autopilot-runtime-marker"))
        .expect("autopilot submission did not reach model");
    let body: Value = serde_json::from_slice(&request.body).unwrap();
    assert_eq!(body["messages"][0]["role"], "user");

    common::invoke_ok(
        "reflect_update_autopilot_config",
        json!({"config":{
            "enabled": false,
            "schedule": "* * * * *",
            "taskTemplate": "disabled-marker",
            "maxConcurrent": 1
        }}),
    );
    let before = runtime
        .block_on(provider.received_requests())
        .unwrap()
        .len();
    std::thread::sleep(Duration::from_millis(1300));
    let after = runtime
        .block_on(provider.received_requests())
        .unwrap()
        .len();
    assert_eq!(before, after, "disabled autopilot triggered again");
    assert!(!history.as_array().unwrap().is_empty(), "{history}");

    let rebound_session = common::invoke_ok("reflect_create_session", json!({}));
    common::invoke_ok("reflect_bind_session", json!({"id": rebound_session}));
    common::invoke_ok(
        "reflect_update_autopilot_config",
        json!({"config":{
            "enabled": true,
            "schedule": "* * * * *",
            "taskTemplate": "autopilot-rebound-marker",
            "maxConcurrent": 1
        }}),
    );
    force_next_due();
    wait_history_success_count(2);
    let requests = runtime.block_on(provider.received_requests()).unwrap();
    assert!(
        requests.iter().any(|request| {
            String::from_utf8_lossy(&request.body).contains("autopilot-rebound-marker")
        }),
        "autopilot did not follow the rebound session"
    );

    let release = Arc::new((Mutex::new(false), Condvar::new()));
    let response_release = release.clone();
    let (waiting_tx, waiting_rx) = channel::<()>();
    let cancellation_reply = reply();
    runtime.block_on(async {
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("autopilot-cancel-marker"))
            .respond_with(move |_: &Request| {
                let _ = waiting_tx.send(());
                let (lock, ready) = &*response_release;
                let guard = lock.lock().unwrap();
                let _guard = ready.wait_while(guard, |released| !*released).unwrap();
                ResponseTemplate::new(200)
                    .set_body_raw(cancellation_reply.clone(), "text/event-stream")
            })
            .with_priority(1)
            .mount(&provider)
            .await;
    });
    let cancellation_session = common::invoke_ok("reflect_create_session", json!({}));
    common::invoke_ok("reflect_bind_session", json!({"id": cancellation_session}));
    common::invoke_ok(
        "reflect_update_autopilot_config",
        json!({"config":{
            "enabled": true,
            "schedule": "* * * * *",
            "taskTemplate": "autopilot-cancel-marker",
            "maxConcurrent": 1
        }}),
    );
    force_next_due();
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let event = events_rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .expect("autopilot cancellation turn did not start");
        if event["msg"]["type"] == "turn_started" {
            break;
        }
    }
    waiting_rx
        .recv_timeout(Duration::from_secs(5))
        .expect("gated cancellation model request did not start");
    common::invoke_ok("reflect_interrupt", json!({}));
    let cancelled = wait_for_failure_reason(&events_rx, "autopilot turn aborted");
    assert_eq!(cancelled["status"], "failed", "{cancelled}");
    {
        let (lock, ready) = &*release;
        *lock.lock().unwrap() = true;
        ready.notify_all();
    }

    runtime.block_on(async {
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("autopilot-failure-marker"))
            .respond_with(ResponseTemplate::new(500).set_body_string("fixture autopilot failure"))
            .with_priority(1)
            .mount(&provider)
            .await;
    });
    let failure_session = common::invoke_ok("reflect_create_session", json!({}));
    common::invoke_ok("reflect_bind_session", json!({"id": failure_session}));
    common::invoke_ok(
        "reflect_update_autopilot_config",
        json!({"config":{
            "enabled": true,
            "schedule": "* * * * *",
            "taskTemplate": "autopilot-failure-marker",
            "maxConcurrent": 1
        }}),
    );
    force_next_due();
    let failed = wait_for_provider_failure(&events_rx);
    assert_eq!(failed["status"], "failed", "{failed}");
}
