//! 本地 LSP 子进程与桌面真实 IPC、工具注册表及诊断缓存的集成。
mod common;

use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tauri::Manager;

#[test]
fn lsp_warmup_diagnostics_hover_and_restart() {
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures/lsp-stdio-server.mjs");
    let fixture = serde_json::to_string(&fixture.to_string_lossy()).unwrap();
    common::set_config_before_install(&format!(
        "[hooks]\nenabled = []\n[lsp_servers.fixture]\ncommand = \"node\"\n\
         args = [{fixture}]\nfile_patterns = [{{ glob = \"**/*.rs\", language_id = \"rust\" }}]\n\
         [lsp_servers.missing]\ncommand = \"zhuye-test-nonexistent-lsp\"\n\
         file_patterns = [{{ glob = \"**/*.rs\", language_id = \"rust\" }}]\n"
    ));
    let (tx, rx) = std::sync::mpsc::channel();
    common::listen("reflect_event", move |event: tauri::Event| {
        if let Ok(value) = serde_json::from_str::<Value>(event.payload()) {
            let _ = tx.send(value);
        }
    });
    let workspace = std::env::current_dir().unwrap();
    std::fs::write(workspace.join("fixture.rs"), "fn fixture_lsp_source() {}\n").unwrap();

    assert_eq!(
        common::invoke_ok("reflect_lsp_status", json!({}))["enabled"],
        false
    );
    let tools = {
        let h = common::harness();
        h.app
            .state::<reflect_desktop_lib::state::MinimalAgent>()
            .tools()
    };
    assert!(tools.get("lsp").is_none());
    for attempt in 0..2 {
        let enabled = common::invoke_ok("reflect_lsp_set_enabled", json!({ "enabled": true }));
        assert_eq!(enabled["enabled"], true);
        let deadline = Instant::now() + Duration::from_secs(20);
        let mut started = None;
        let mut failed = None;
        while started.is_none() || failed.is_none() {
            let event = rx
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .expect("LSP 启动或失败事件超时");
            if event["msg"]["type"] == "lsp_server_started" && event["msg"]["server"] == "fixture" {
                started = Some(event);
            } else if event["msg"]["type"] == "lsp_server_failed"
                && event["msg"]["server"] == "missing"
            {
                failed = Some(event);
            }
        }
        let started = started.unwrap();
        let failed = failed.unwrap();
        assert_eq!(failed["id"], "");
        assert_eq!(failed["msg"]["will_retry"], false);
        assert!(
            failed["msg"]["error"]
                .as_str()
                .is_some_and(|s| !s.is_empty())
        );
        assert_eq!(started["id"], "");
        assert!(
            started["msg"]["methods"]
                .as_array()
                .unwrap()
                .iter()
                .any(|v| v == "textDocument/hover")
        );
        assert!(
            started["msg"]["language_ids"]
                .as_array()
                .unwrap()
                .iter()
                .any(|v| v == "rust")
        );
        let warmup = common::invoke_ok("reflect_lsp_warmup", json!({ "path": "fixture.rs" }));
        assert_eq!(warmup["warmed"], true, "{warmup}");
        assert_eq!(warmup["server"], "fixture");
        assert!(common::invoke("reflect_lsp_warmup", json!({ "path": "../outside.rs" })).is_err());

        let deadline = Instant::now() + Duration::from_secs(15);
        let diagnostics = loop {
            let result =
                common::invoke_ok("reflect_lsp_diagnostics", json!({ "path": "fixture.rs" }));
            if !result.as_array().unwrap().is_empty() {
                break result;
            }
            assert!(Instant::now() < deadline, "LSP 诊断未到达");
            std::thread::sleep(Duration::from_millis(50));
        };
        assert_eq!(diagnostics.as_array().unwrap().len(), 1);
        assert_eq!(diagnostics[0]["line"], 2);
        assert_eq!(diagnostics[0]["column"], 3);
        assert_eq!(diagnostics[0]["endLine"], 2);
        assert_eq!(diagnostics[0]["endColumn"], 6);
        assert_eq!(diagnostics[0]["severity"], "warning");
        assert_eq!(diagnostics[0]["message"], "fixture diagnostic");
        assert_eq!(diagnostics[0]["source"], "fixture-lsp");
        assert_eq!(diagnostics[0]["code"], "TEST001");
        let status = common::invoke_ok("reflect_lsp_status", json!({}));
        assert_eq!(status["servers"], json!(["fixture"]));
        assert_eq!(status["diagnostics"]["documents"], 1);
        assert_eq!(status["diagnostics"]["count"], 1);

        let tool = tools.get("lsp").expect("LSP 工具未注册");
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let output = runtime
            .block_on(tool.execute(
                reflect_tools::ToolContext::for_workspace(&workspace),
                json!({ "action": "hover", "file_path": "fixture.rs", "line": 0, "character": 3 }),
            ))
            .unwrap();
        assert!(!output.is_error, "{output:?}");
        assert!(output.content.iter().any(|block| matches!(
            block,
            reflect_protocol::ContentBlock::Text { text } if text.contains("fixture hover response")
        )), "{output:?}");

        let disabled = common::invoke_ok("reflect_lsp_set_enabled", json!({ "enabled": false }));
        assert_eq!(disabled["enabled"], false, "attempt {attempt}: {disabled}");
        assert!(tools.get("lsp").is_none());
        assert_eq!(
            common::invoke_ok("reflect_lsp_diagnostics", json!({ "path": "fixture.rs" })),
            json!([])
        );
    }
}
