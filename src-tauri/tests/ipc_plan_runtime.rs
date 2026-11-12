//! 计划模式的真实请求、回执、文件和权限状态链路。
mod common;

use std::sync::mpsc::{Receiver, channel};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

fn wait_event(rx: &Receiver<Value>, kind: &str, id: &str) -> Value {
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut seen = Vec::new();
    while let Ok(event) = rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
        if event["id"] == id && event["msg"]["type"] == kind {
            return event;
        }
        seen.push(event);
    }
    panic!("未收到 {kind}#{id}，收到: {seen:#?}");
}

#[test]
fn plan_request_and_ready_use_distinct_ids_and_apply_approval() {
    let (tx, rx) = channel();
    common::listen("reflect_event", move |event: tauri::Event| {
        if let Ok(value) = serde_json::from_str::<Value>(event.payload()) {
            let _ = tx.send(value);
        }
    });
    let enter = common::invoke_ok(
        "reflect_enter_plan_mode",
        json!({ "task": "Inspect the migration" }),
    );
    let enter_id = enter.as_str().unwrap();
    let request = wait_event(&rx, "plan_request", enter_id);
    assert_eq!(request["msg"]["task"], "Inspect the migration");
    let request_plan_id = request["msg"]["plan_id"].as_str().unwrap();
    assert!(uuid::Uuid::parse_str(request_plan_id).is_ok());
    common::invoke_ok(
        "reflect_plan_approval",
        json!({ "id": request_plan_id, "choice": "manual_approve" }),
    );
    let entered = wait_event(&rx, "permission_mode_changed", enter_id);
    assert_eq!(entered["msg"]["to"], "plan");

    let exit = common::invoke_ok("reflect_exit_plan_mode", json!({}));
    let exit_id = exit.as_str().unwrap();
    let ready = wait_event(&rx, "plan_ready", exit_id);
    let ready_plan_id = ready["msg"]["plan_id"].as_str().unwrap();
    assert!(uuid::Uuid::parse_str(ready_plan_id).is_ok());
    assert_ne!(ready_plan_id, request_plan_id);
    let markdown = ready["msg"]["markdown"].as_str().unwrap();
    assert!(!markdown.trim().is_empty());
    let path = std::path::PathBuf::from(ready["msg"]["path"].as_str().unwrap());
    assert!(
        path.canonicalize()
            .unwrap()
            .starts_with(std::env::current_dir().unwrap().canonicalize().unwrap())
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), markdown);
    common::invoke_ok(
        "reflect_plan_approval",
        json!({ "id": ready_plan_id, "choice": "revise" }),
    );
    let rejected = wait_event(&rx, "plan_rejected", exit_id);
    assert_eq!(rejected["msg"]["plan_id"], ready_plan_id);

    let second_exit = common::invoke_ok("reflect_exit_plan_mode", json!({}));
    let second_id = second_exit.as_str().unwrap();
    let second_ready = wait_event(&rx, "plan_ready", second_id);
    let second_plan_id = second_ready["msg"]["plan_id"].as_str().unwrap();
    common::invoke_ok(
        "reflect_plan_approval",
        json!({ "id": second_plan_id, "choice": "manual_approve" }),
    );
    let mode = wait_event(&rx, "permission_mode_changed", second_id);
    assert_eq!(mode["msg"]["from"], "plan");
    assert_eq!(mode["msg"]["to"], "prompt");
    let approved = wait_event(&rx, "plan_approved", second_id);
    assert_eq!(approved["msg"]["plan_id"], second_plan_id);
}
