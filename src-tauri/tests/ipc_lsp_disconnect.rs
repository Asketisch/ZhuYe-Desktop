//! 意外退出的 LSP 服务应从状态中移除，用户可重新开启。
mod common;
use serde_json::{Value, json};
use std::time::{Duration, Instant};

#[test]
fn unexpected_disconnect_emits_failure_and_can_restart() {
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures/lsp-stdio-server.mjs");
    let fixture = serde_json::to_string(&fixture.to_string_lossy()).unwrap();
    common::set_config_before_install(&format!(
        "[hooks]\nenabled = []\n[lsp_servers.fixture]\ncommand = \"node\"\nargs = [{fixture}]\nfile_patterns = [{{ glob = \"**/*.rs\", language_id = \"rust\" }}]\n"
    ));
    let (tx, rx) = std::sync::mpsc::channel::<Value>();
    common::listen("reflect_event", move |event: tauri::Event| {
        if let Ok(value) = serde_json::from_str(event.payload()) {
            let _ = tx.send(value);
        }
    });
    std::fs::write("disconnect.rs", "fn fixture_lsp_exit_now() {}\n").unwrap();
    common::invoke_ok("reflect_lsp_set_enabled", json!({"enabled":true}));
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let event = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .expect("LSP did not start");
        if event["msg"]["type"] == "lsp_server_started" && event["msg"]["server"] == "fixture" {
            break;
        }
    }
    common::invoke_ok("reflect_lsp_warmup", json!({"path":"disconnect.rs"}));
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let event = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .expect("disconnect failure event missing");
        if event["msg"]["type"] == "lsp_server_failed" && event["msg"]["server"] == "fixture" {
            assert_eq!(event["msg"]["will_retry"], false);
            break;
        }
    }
    assert_eq!(
        common::invoke_ok("reflect_lsp_status", json!({}))["servers"],
        json!([])
    );
    common::invoke_ok("reflect_lsp_set_enabled", json!({"enabled":false}));
    std::fs::write("disconnect.rs", "fn fixture_lsp_source() {}\n").unwrap();
    common::invoke_ok("reflect_lsp_set_enabled", json!({"enabled":true}));
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let event = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .expect("LSP did not restart");
        if event["msg"]["type"] == "lsp_server_started" && event["msg"]["server"] == "fixture" {
            break;
        }
    }
    assert_eq!(
        common::invoke_ok("reflect_lsp_warmup", json!({"path":"disconnect.rs"}))["warmed"],
        true
    );
    common::invoke_ok("reflect_lsp_set_enabled", json!({"enabled":false}));
}
