//! 进程意外退出后，Autopilot 应恢复并释放未完成运行的并发名额。
mod common;

use serde_json::{Value, json};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const PHASE: &str = "REFLECT_AUTOPILOT_RESTART_PHASE";
const BASE: &str = "REFLECT_TEST_HOME";
const TEST: &str = "autopilot_recovers_interrupted_run_after_process_restart";
const PROMPT: &str = "autopilot-restart-recovery-marker";

struct ChildGuard(std::process::Child);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn reply() -> &'static str {
    concat!(
        "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"restart\",\"model\":\"claude-mock\",\"usage\":{\"input_tokens\":1}}}\n\n",
        "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n",
        "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"done\"}}\n\n",
        "event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}\n\n",
        "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":1}}\n\n",
        "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"
    )
}

fn wait_history(predicate: impl Fn(&[Value]) -> bool) -> Vec<Value> {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let history = common::invoke_ok("reflect_autopilot_history", json!({}));
        let runs = history.as_array().unwrap();
        if predicate(runs) {
            return runs.clone();
        }
        assert!(
            Instant::now() < deadline,
            "autopilot history did not reach expected state: {history}"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn autopilot_recovers_interrupted_run_after_process_restart() {
    // This binary has one test and this is before starting either runtime.
    unsafe {
        std::env::set_var("ZHUYE_AUTOPILOT_TICK_SECS", "1");
    }
    if std::env::var(PHASE).as_deref() == Ok("child") {
        let session = common::invoke_ok("reflect_create_session", json!({}));
        common::invoke_ok("reflect_bind_session", json!({"id":session}));
        common::invoke_ok(
            "reflect_update_autopilot_config",
            json!({"config":{
                "enabled":true,"schedule":"* * * * *","taskTemplate":PROMPT,"maxConcurrent":1
            }}),
        );
        let config = common::isolated_home().join(".zhuye/autopilot/config.json");
        std::fs::OpenOptions::new()
            .write(true)
            .open(config)
            .unwrap()
            .set_times(
                std::fs::FileTimes::new()
                    .set_modified(SystemTime::now() - Duration::from_secs(120)),
            )
            .unwrap();
        let history = wait_history(|runs| runs.iter().any(|run| run["status"] == "inProgress"));
        let file = std::path::PathBuf::from(std::env::var_os(BASE).unwrap()).join("run-id");
        std::fs::write(file, history[0]["id"].as_str().unwrap()).unwrap();
        std::thread::sleep(Duration::from_secs(60));
        panic!("parent did not terminate child");
    }
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    let provider = runtime.block_on(async {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_raw(reply(), "text/event-stream")
                    .set_delay(Duration::from_secs(5)),
            )
            .mount(&server)
            .await;
        server
    });
    let shared = tempfile::tempdir().unwrap();
    let data = shared.path().join("home/.zhuye");
    std::fs::create_dir_all(&data).unwrap();
    std::fs::write(data.join("config.toml"), format!("[active]\nprovider = \"anthropic\"\n[anthropic]\napi_key = \"test-key\"\nbase_url = \"{}\"\nmodel = \"claude-mock\"\n[hooks]\nenabled = []\n", provider.uri())).unwrap();
    let mut child = ChildGuard(
        std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", TEST, "--nocapture"])
            .env(PHASE, "child")
            .env(BASE, shared.path())
            .spawn()
            .unwrap(),
    );
    let id_path = shared.path().join("run-id");
    let deadline = Instant::now() + Duration::from_secs(15);
    while !id_path.exists() {
        if let Some(status) = child.0.try_wait().unwrap() {
            panic!("child exited before active run: {status}");
        }
        if Instant::now() >= deadline {
            panic!("child did not start autopilot");
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    let old_id = std::fs::read_to_string(id_path).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while runtime
        .block_on(provider.received_requests())
        .unwrap()
        .is_empty()
    {
        assert!(
            Instant::now() < deadline,
            "original model request did not start"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    // A second desktop process must not claim or fail the live owner's run.
    unsafe {
        std::env::set_var(BASE, shared.path());
    }
    let config = common::invoke_ok("reflect_get_autopilot_config", json!({}));
    assert_eq!(config["taskTemplate"], PROMPT);
    assert_eq!(config["enabled"], true);
    std::thread::sleep(Duration::from_millis(1300));
    let live = common::invoke_ok("reflect_autopilot_history", json!({}));
    assert!(
        live.as_array()
            .unwrap()
            .iter()
            .any(|run| run["id"] == old_id && run["status"] == "inProgress"),
        "another desktop changed the live run: {live}"
    );
    // Make the interrupted run due again, avoiding a wall-clock minute wait.
    let history_file = data.join("autopilot/history.json");
    let mut history: Value =
        serde_json::from_slice(&std::fs::read(&history_file).unwrap()).unwrap();
    history[0]["executedAtMs"] = json!(
        (SystemTime::now() - Duration::from_secs(120))
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
    );
    std::fs::write(&history_file, serde_json::to_vec_pretty(&history).unwrap()).unwrap();
    child.0.kill().unwrap();
    child.0.wait().unwrap();
    let session = common::invoke_ok("reflect_create_session", json!({}));
    common::invoke_ok("reflect_bind_session", json!({"id":session}));
    let runs = wait_history(|runs| {
        runs.iter()
            .any(|r| r["id"] == old_id && r["status"] == "failed")
            && runs
                .iter()
                .any(|r| r["id"] != old_id && r["status"] == "success")
    });
    assert!(
        runs.iter()
            .any(|r| r["id"] == old_id && r["error"].as_str().is_some_and(|s| !s.is_empty())),
        "interrupted run lacks explanation: {runs:?}"
    );
    let requests = runtime.block_on(provider.received_requests()).unwrap();
    assert!(
        requests
            .iter()
            .filter(|request| String::from_utf8_lossy(&request.body).contains(PROMPT))
            .count()
            >= 2,
        "both original and restarted runs must reach the model: {} requests",
        requests.len()
    );
}
