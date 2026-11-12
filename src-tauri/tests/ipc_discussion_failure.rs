//! 出错的讨论必须在事件通道进入终态，不能一直显示运行中。
mod common;

use std::sync::mpsc::channel;
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[test]
fn provider_failure_emits_a_terminal_discussion_event() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap();
    let provider = runtime.block_on(async {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .respond_with(
                ResponseTemplate::new(401).set_body_string("fixture authentication failure"),
            )
            .mount(&server)
            .await;
        server
    });
    common::set_config_before_install(&format!(
        "[active]\nprovider = \"anthropic\"\n[anthropic]\napi_key = \"test-key\"\nbase_url = \"{}\"\nmodel = \"claude-mock\"\n[hooks]\nenabled = []\n",
        provider.uri()
    ));
    let (tx, rx) = channel::<Value>();
    common::listen("reflect_event", move |event: tauri::Event| {
        if let Ok(value) = serde_json::from_str(event.payload()) {
            let _ = tx.send(value);
        }
    });
    std::fs::write(
        "discussion-error.toml",
        r#"[discussion]
mode = "sequential"
topic = "failure"
max_rounds = 1
[[agents]]
role = "first"
system_prompt = "speak"
[[agents]]
role = "second"
system_prompt = "respond"
"#,
    )
    .unwrap();
    let result = common::invoke(
        "reflect_run_discussion",
        json!({"configPath":"discussion-error.toml"}),
    );
    assert!(result.is_err(), "{result:?}");
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut id = None;
    let mut terminal = None;
    while let Ok(event) = rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
        if event["msg"]["type"] == "collab_started" {
            id = event["msg"]["id"].as_str().map(str::to_owned);
        }
        if event["msg"]["type"] == "collab_finished" && event["msg"]["id"].as_str() == id.as_deref()
        {
            terminal = Some(event);
            break;
        }
    }
    assert!(id.is_some(), "discussion did not emit its start event");
    let terminal = terminal.expect("failed discussion did not emit a terminal event");
    assert_eq!(terminal["msg"]["outcome"], "failed");
}
