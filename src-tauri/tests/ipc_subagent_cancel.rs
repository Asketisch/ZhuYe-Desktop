//! 定向中断真实运行中的子代理，不中断父回合。
mod common;

use serde_json::{Value, json};
use std::sync::{
    Arc, Condvar, Mutex,
    mpsc::{Receiver, channel},
};
use std::time::{Duration, Instant};
use wiremock::matchers::{body_string_contains, method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

fn reply(tool: bool) -> String {
    let (block, delta, stop) = if tool {
        (
            json!({"type":"tool_use","id":"toolu_cancel_child","name":"call_explorer"}),
            json!({"type":"input_json_delta","partial_json":"{\"prompt\":\"blocked-child-marker\"}"}),
            "tool_use",
        )
    } else {
        (
            json!({"type":"text","text":""}),
            json!({"type":"text_delta","text":"parent-survived"}),
            "end_turn",
        )
    };
    [
        ("message_start", json!({"type":"message_start","message":{"id":"cancel-test","model":"claude-mock","usage":{"input_tokens":1}}})),
        ("content_block_start", json!({"type":"content_block_start","index":0,"content_block":block})),
        ("content_block_delta", json!({"type":"content_block_delta","index":0,"delta":delta})),
        ("content_block_stop", json!({"type":"content_block_stop","index":0})),
        ("message_delta", json!({"type":"message_delta","delta":{"stop_reason":stop},"usage":{"output_tokens":1}})),
        ("message_stop", json!({"type":"message_stop"})),
    ].iter().map(|(name, data)| format!("event: {name}\ndata: {data}\n\n")).collect()
}

fn wait_for(
    rx: &Receiver<Value>,
    seen: &mut Vec<Value>,
    predicate: impl Fn(&Value) -> bool,
) -> Value {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let event = rx
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .unwrap_or_else(|_| panic!("event timeout: {seen:#?}"));
        if predicate(&event) {
            return event;
        }
        seen.push(event);
    }
}

struct Release(Arc<(Mutex<bool>, Condvar)>);
impl Drop for Release {
    fn drop(&mut self) {
        let (lock, ready) = &*self.0;
        *lock.lock().unwrap() = true;
        ready.notify_all();
    }
}

#[test]
fn targeted_interrupt_cancels_child_and_parent_continues() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    let release = Arc::new((Mutex::new(false), Condvar::new()));
    let server_release = release.clone();
    let (waiting_tx, waiting_rx) = channel();
    let provider = runtime.block_on(async {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("cancel-parent-marker"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(reply(true), "text/event-stream"))
            .with_priority(3)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("blocked-child-marker"))
            .respond_with(move |_: &Request| {
                let _ = waiting_tx.send(());
                let (lock, ready) = &*server_release;
                let guard = lock.lock().unwrap();
                let _guard = ready.wait_while(guard, |released| !*released).unwrap();
                ResponseTemplate::new(200).set_body_raw(reply(false), "text/event-stream")
            })
            .with_priority(2)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .and(body_string_contains("toolu_cancel_child"))
            .and(body_string_contains("tool_result"))
            .respond_with(
                ResponseTemplate::new(200).set_body_raw(reply(false), "text/event-stream"),
            )
            .with_priority(1)
            .mount(&server)
            .await;
        server
    });
    let _release = Release(release);
    common::set_config_before_install(&format!(
        "[active]\nprovider = \"anthropic\"\n[anthropic]\napi_key = \"test-key\"\nbase_url = \"{}\"\nmodel = \"claude-mock\"\n[hooks]\nenabled = []\n",
        provider.uri()
    ));
    let (tx, rx) = channel();
    common::listen("reflect_event", move |event: tauri::Event| {
        if let Ok(value) = serde_json::from_str(event.payload()) {
            let _ = tx.send(value);
        }
    });
    let session = common::invoke_ok("reflect_create_session", json!({}));
    common::invoke_ok("reflect_bind_session", json!({"id":session}));
    common::invoke_ok("reflect_set_permission_mode", json!({"mode":"prompt"}));
    common::invoke_ok(
        "reflect_submit",
        json!({"submission":{"id":"cancel-parent", "op":{
            "type":"user_input", "items":[{"type":"text","text":"cancel-parent-marker"}]
        }}}),
    );
    let mut seen = Vec::new();
    let approval = wait_for(&rx, &mut seen, |event| {
        event["msg"]["type"] == "approval_request"
            && event["msg"]["kind"]["tool_name"] == "call_explorer"
    });
    common::invoke_ok(
        "reflect_tool_approval",
        json!({"id":approval["msg"]["request_id"],"decision":"approve"}),
    );
    waiting_rx
        .recv_timeout(Duration::from_secs(20))
        .expect("child request did not start");
    let query = common::invoke_ok("reflect_query_subagents", json!({}));
    let active = wait_for(&rx, &mut seen, |event| {
        event["id"] == query && event["msg"]["type"] == "subagent_status"
    });
    let child = active["msg"]["children"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["role"] == "explorer" && entry["state"] == "running")
        .unwrap_or_else(|| panic!("no running child: {active}"))["child_id"]
        .as_str()
        .unwrap()
        .to_string();
    common::invoke_ok("reflect_interrupt", json!({"childId":child}));
    let stopped = wait_for(&rx, &mut seen, |event| {
        event["id"] == "cancel-parent"
            && event["msg"]["type"] == "tool_call_end"
            && event["msg"]["call_id"] == "toolu_cancel_child"
    });
    assert_eq!(stopped["msg"]["is_error"], true, "{stopped}");
    let query = common::invoke_ok("reflect_query_subagents", json!({"childId":child}));
    let final_status = wait_for(&rx, &mut seen, |event| {
        event["id"] == query && event["msg"]["type"] == "subagent_status"
    });
    assert!(
        final_status["msg"]["children"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["child_id"] == child && entry["state"] == "cancelled"),
        "{final_status}"
    );
    drop(_release);
    if !seen
        .iter()
        .any(|event| event["id"] == "cancel-parent" && event["msg"]["type"] == "turn_complete")
    {
        wait_for(&rx, &mut seen, |event| {
            event["id"] == "cancel-parent" && event["msg"]["type"] == "turn_complete"
        });
    }
    assert!(
        seen.iter()
            .any(|event| event["msg"]["type"] == "agent_message_delta"
                && event["msg"]["delta"] == "parent-survived")
    );
}
