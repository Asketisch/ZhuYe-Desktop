//! LSP 在握手期间关闭时，不应重新出现已关闭的服务。
mod common;

use std::time::{Duration, Instant};

use serde_json::{Value, json};

#[test]
fn disabling_during_initialization_does_not_emit_started() {
    let temp = tempfile::tempdir().unwrap();
    let marker = temp.path().join("initializing");
    let shutdown_marker = temp.path().join("shutdown");
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures/lsp-stdio-server.mjs");
    let fixture = serde_json::to_string(&fixture.to_string_lossy()).unwrap();
    let marker_json = serde_json::to_string(&marker.to_string_lossy()).unwrap();
    let shutdown_json = serde_json::to_string(&shutdown_marker.to_string_lossy()).unwrap();
    common::set_config_before_install(&format!(
        "[hooks]\nenabled = []\n[lsp_servers.slow]\ncommand = \"node\"\n\
         args = [{fixture}]\nfile_patterns = [{{ glob = \"**/*.rs\", language_id = \"rust\" }}]\n\
         [lsp_servers.slow.env]\nLSP_INITIALIZING_MARKER = {marker_json}\n\
         LSP_SHUTDOWN_MARKER = {shutdown_json}\n"
    ));
    let (tx, rx) = std::sync::mpsc::channel();
    common::listen("reflect_event", move |event: tauri::Event| {
        if let Ok(value) = serde_json::from_str::<Value>(event.payload()) {
            let _ = tx.send(value);
        }
    });
    assert_eq!(
        common::invoke_ok("reflect_lsp_set_enabled", json!({ "enabled": true }))["enabled"],
        true
    );
    let deadline = Instant::now() + Duration::from_secs(10);
    while !marker.exists() {
        assert!(Instant::now() < deadline, "LSP 没有开始握手");
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(
        common::invoke_ok("reflect_lsp_set_enabled", json!({ "enabled": false }))["enabled"],
        false
    );
    let deadline = Instant::now() + Duration::from_secs(3);
    while let Ok(event) = rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
        assert!(
            event["msg"]["type"] != "lsp_server_started" || event["msg"]["server"] != "slow",
            "关闭后不应上报握手完成: {event}"
        );
    }
    assert!(shutdown_marker.exists(), "握手后应关闭已过期的 LSP 进程");
    assert_eq!(
        common::invoke_ok("reflect_lsp_status", json!({}))["enabled"],
        false
    );

    // 第二轮在旧握手仍未完成时立即重开；只能收到新实例的一次启动事件。
    std::fs::remove_file(&marker).unwrap();
    std::fs::remove_file(&shutdown_marker).unwrap();
    common::invoke_ok("reflect_lsp_set_enabled", json!({ "enabled": true }));
    let deadline = Instant::now() + Duration::from_secs(10);
    while !marker.exists() {
        assert!(Instant::now() < deadline, "第二轮 LSP 没有开始握手");
        std::thread::sleep(Duration::from_millis(20));
    }
    common::invoke_ok("reflect_lsp_set_enabled", json!({ "enabled": false }));
    common::invoke_ok("reflect_lsp_set_enabled", json!({ "enabled": true }));
    let deadline = Instant::now() + Duration::from_secs(4);
    let mut started = 0;
    while let Ok(event) = rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
        if event["msg"]["type"] == "lsp_server_started" && event["msg"]["server"] == "slow" {
            started += 1;
        }
    }
    assert_eq!(started, 1, "重开后应只有新服务发出启动事件");
    assert!(shutdown_marker.exists(), "被替换的旧服务应关闭");
    let status = common::invoke_ok("reflect_lsp_status", json!({}));
    assert_eq!(status["enabled"], true);
    assert_eq!(status["servers"], json!(["slow"]));
    common::invoke_ok("reflect_lsp_set_enabled", json!({ "enabled": false }));

    // 并发启用必须共享一个管理器，不能启动重复子进程。
    std::fs::remove_file(&marker).unwrap();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));
    let workers: Vec<_> = (0..8)
        .map(|_| {
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                common::invoke_ok("reflect_lsp_set_enabled", json!({ "enabled": true }))
            })
        })
        .collect();
    for worker in workers {
        assert_eq!(worker.join().unwrap()["enabled"], true);
    }
    let deadline = Instant::now() + Duration::from_secs(10);
    while !marker.exists() {
        assert!(Instant::now() < deadline, "并发启用未启动 LSP");
        std::thread::sleep(Duration::from_millis(20));
    }
    let mut seen_started = false;
    while !seen_started {
        let event = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .expect("并发启用没有启动事件");
        seen_started =
            event["msg"]["type"] == "lsp_server_started" && event["msg"]["server"] == "slow";
    }
    assert_eq!(std::fs::read_to_string(&marker).unwrap().lines().count(), 1);
    common::invoke_ok("reflect_lsp_set_enabled", json!({ "enabled": false }));
}
