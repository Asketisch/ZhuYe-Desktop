//! 扩展重扫经真实 IPC 和 AgentThread 回传与提交配对的事件。

mod common;

use std::sync::mpsc::channel;
use std::time::{Duration, Instant};

use serde_json::{Value, json};

fn rescan_and_wait(rx: &std::sync::mpsc::Receiver<Value>) -> Value {
    let id = common::invoke_ok(
        "reflect_rescan_extensions",
        json!({ "skills": true, "commands": true }),
    );
    let id = id.as_str().expect("rescan returns submission id");
    let deadline = Instant::now() + Duration::from_secs(20);
    while let Ok(event) = rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
        if event["id"] == id && event["msg"]["type"] == "extensions_rescanned" {
            return event["msg"].clone();
        }
    }
    panic!("no extensions_rescanned event for submission {id}");
}

#[test]
fn rescanning_adds_and_removes_a_skill_and_pairs_the_acknowledgement() {
    let _guard = common::state_lock();
    let (tx, rx) = channel();
    common::listen("reflect_event", move |event| {
        if let Ok(value) = serde_json::from_str(event.payload()) {
            let _ = tx.send(value);
        }
    });
    // 占位线程尚未装载会话扩展；真实会话绑定后才有运行时 catalog。
    let session = common::invoke_ok("reflect_create_session", json!({}));
    common::invoke_ok("reflect_bind_session", json!({ "id": session }));
    let skill = reflect_config::paths::data_path_or_relative(&["skills", "rescan-probe"]);
    std::fs::create_dir_all(&skill).expect("create skill directory");
    std::fs::write(
        skill.join("SKILL.md"),
        "---\nname: rescan-probe\ndescription: Test rescan\n---\nTest skill.\n",
    )
    .expect("write skill");

    let added = rescan_and_wait(&rx);
    assert_eq!(added["skills"], 1, "new skill must enter runtime catalog");
    assert_eq!(added["commands"], false, "command rescan is not supported");
    std::fs::remove_dir_all(skill).expect("remove skill");
    let removed = rescan_and_wait(&rx);
    assert_eq!(
        removed["skills"], 0,
        "removed skill must leave runtime catalog"
    );
}
