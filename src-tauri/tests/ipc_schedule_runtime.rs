//! 真 cron driver → AgentThread → 本地模型 → 事件及调度状态。
mod common;

use std::sync::mpsc::{RecvTimeoutError, channel};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use wiremock::matchers::{body_string_contains, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[test]
fn scheduled_turn_fires_after_rebind_and_disabled_job_stays_idle() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    let provider = runtime.block_on(async {
        let server = MockServer::start().await;
        let body = concat!(
            "event: message_start\n",
            "data: {\"type\":\"message_start\",\"message\":{\"id\":\"cron-msg\",",
            "\"model\":\"claude-mock\",\"usage\":{\"input_tokens\":10}}}\n\n",
            "event: content_block_start\n",
            "data: {\"type\":\"content_block_start\",\"index\":0,",
            "\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n",
            "event: content_block_delta\n",
            "data: {\"type\":\"content_block_delta\",\"index\":0,",
            "\"delta\":{\"type\":\"text_delta\",\"text\":\"scheduled response verified\"}}\n\n",
            "event: content_block_stop\n",
            "data: {\"type\":\"content_block_stop\",\"index\":0}\n\n",
            "event: message_delta\n",
            "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},",
            "\"usage\":{\"output_tokens\":5}}\n\n",
            "event: message_stop\n",
            "data: {\"type\":\"message_stop\"}\n\n"
        );
        server
            .register(
                Mock::given(method("POST"))
                    .and(path("/v1/messages"))
                    .and(body_string_contains("runtime-scheduled-enabled"))
                    .respond_with(
                        ResponseTemplate::new(200).set_body_raw(body, "text/event-stream"),
                    ),
            )
            .await;
        server
    });
    common::set_config_before_install(&format!(
        "[active]\nprovider = \"anthropic\"\n[anthropic]\napi_key = \"test-key\"\n\
         base_url = \"{}\"\nmodel = \"claude-mock\"\n[hooks]\nenabled = []\n",
        provider.uri()
    ));
    let (tx, rx) = channel();
    common::listen("reflect_event", move |event: tauri::Event| {
        if let Ok(value) = serde_json::from_str::<Value>(event.payload()) {
            let _ = tx.send(value);
        }
    });
    let enabled = common::invoke_ok(
        "reflect_add_schedule",
        json!({ "schedule": "* * * * *", "prompt": "runtime-scheduled-enabled", "name": "enabled" }),
    );
    let disabled = common::invoke_ok(
        "reflect_add_schedule",
        json!({ "schedule": "* * * * *", "prompt": "runtime-scheduled-disabled", "name": "disabled" }),
    );
    let enabled_id = enabled["id"].as_str().unwrap();
    let disabled_id = disabled["id"].as_str().unwrap();
    common::invoke_ok(
        "reflect_update_schedule",
        json!({ "id": disabled_id, "enabled": false }),
    );
    let session = common::invoke_ok("reflect_create_session", json!({}));
    common::invoke_ok("reflect_bind_session", json!({ "id": session }));

    let deadline = Instant::now() + Duration::from_secs(105);
    let mut reply_id: Option<String> = None;
    let mut event_types = Vec::new();
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        assert!(
            !remaining.is_zero(),
            "定时回合超时，已收到: {event_types:?}"
        );
        match rx.recv_timeout(remaining.min(Duration::from_secs(5))) {
            Ok(event) => {
                let kind = event["msg"]["type"].as_str().unwrap_or("?").to_owned();
                event_types.push(kind.clone());
                if kind == "agent_message_delta"
                    && event["msg"]["delta"] == "scheduled response verified"
                {
                    reply_id = event["id"].as_str().map(str::to_owned);
                }
                if kind == "turn_complete"
                    && reply_id.as_deref() == event["id"].as_str()
                    && reply_id.is_some()
                {
                    break;
                }
            }
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => panic!("定时回合事件通道关闭"),
        }
    }
    assert!(!reply_id.unwrap().is_empty(), "定时回合应有 submission id");
    let requests = runtime.block_on(provider.received_requests()).unwrap();
    assert_eq!(requests.len(), 1, "仅启用的任务应向模型发出一次请求");
    let body = String::from_utf8_lossy(&requests[0].body);
    assert!(body.contains("runtime-scheduled-enabled"));
    assert!(!body.contains("runtime-scheduled-disabled"));
    let list = common::invoke_ok("reflect_list_schedules", json!({}));
    let jobs = list.as_array().unwrap();
    let fired = jobs.iter().find(|job| job["id"] == enabled_id).unwrap();
    let idle = jobs.iter().find(|job| job["id"] == disabled_id).unwrap();
    assert!(fired["last_fired"].is_string(), "{fired}");
    assert!(fired["next_fire"].is_string(), "{fired}");
    assert!(idle["last_fired"].is_null(), "{idle}");
    assert_eq!(idle["enabled"], false);
    assert_eq!(
        common::invoke_ok("reflect_remove_schedule", json!({ "id": enabled_id })),
        true
    );
    assert_eq!(
        common::invoke_ok("reflect_remove_schedule", json!({ "id": disabled_id })),
        true
    );
    assert_eq!(
        common::invoke_ok("reflect_get_schedule_status", json!({}))["status"],
        "idle"
    );
}
