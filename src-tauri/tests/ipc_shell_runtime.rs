//! 多个真实 shell 会话并存、独立退出，并在终止后清理进程。
mod common;

use serde_json::{Value, json};
use std::path::Path;
use std::time::{Duration, Instant};

fn wait_until(timeout: Duration, predicate: impl Fn() -> bool) {
    let deadline = Instant::now() + timeout;
    while !predicate() {
        assert!(Instant::now() < deadline, "condition timed out");
        std::thread::sleep(Duration::from_millis(25));
    }
}

fn sessions() -> Vec<String> {
    common::invoke_ok("reflect_list_shell_sessions", json!({}))
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect()
}

#[test]
fn shell_sessions_are_isolated_and_reaped() {
    let first = common::invoke_ok(
        "reflect_run_shell",
        json!({"cmd":"printf first > shell-first-start; sleep 0.8; printf done > shell-first-end"}),
    );
    let first_id = first["id"].as_str().unwrap();
    let second = common::invoke_ok(
        "reflect_run_shell",
        json!({"cmd":"printf second > shell-second-start; sleep 0.1; printf done > shell-second-end"}),
    );
    let second_id = second["id"].as_str().unwrap();
    assert_ne!(first_id, second_id);
    wait_until(Duration::from_secs(5), || {
        Path::new("shell-first-start").exists() && Path::new("shell-second-start").exists()
    });

    std::thread::sleep(Duration::from_millis(350));
    assert!(
        Path::new("shell-second-end").exists(),
        "short session did not finish independently"
    );
    assert!(
        !Path::new("shell-first-end").exists(),
        "long session was incorrectly reaped with the short one"
    );
    wait_until(Duration::from_secs(5), || {
        let active = sessions();
        active.contains(&first_id.to_owned()) && !active.contains(&second_id.to_owned())
    });

    wait_until(Duration::from_secs(5), || {
        Path::new("shell-first-end").exists() && sessions().is_empty()
    });

    let killed = common::invoke_ok(
        "reflect_run_shell",
        json!({"cmd":"sleep 0.5; printf side-effect > shell-kill-marker"}),
    );
    let killed_id = killed["id"].as_str().unwrap();
    wait_until(Duration::from_secs(3), || {
        sessions().iter().any(|id| id == killed_id)
    });
    common::invoke_ok("reflect_kill_shell", json!({"sessionId":killed_id}));
    std::thread::sleep(Duration::from_millis(650));
    assert!(
        !Path::new("shell-kill-marker").exists(),
        "killed shell continued to a side effect"
    );
    wait_until(Duration::from_secs(3), || sessions().is_empty());
}
