//! 模型实际调用任务及团队工具；桌面 IPC 读回持久状态与工具结果。
mod common;

use serde_json::{Value, json};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, mpsc::channel};
use std::time::{Duration, Instant};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

fn stream(tool: Option<(&str, &str, Value)>) -> String {
    let (block, delta, reason) = if let Some((id, name, args)) = tool {
        (
            json!({"type":"tool_use","id":id,"name":name}),
            json!({"type":"input_json_delta","partial_json":args.to_string()}),
            "tool_use",
        )
    } else {
        (
            json!({"type":"text","text":""}),
            json!({"type":"text_delta","text":"step completed"}),
            "end_turn",
        )
    };
    [
        ("message_start", json!({"type":"message_start","message":{"id":"task-tools","model":"claude-mock","usage":{"input_tokens":5}}})),
        ("content_block_start", json!({"type":"content_block_start","index":0,"content_block":block})),
        ("content_block_delta", json!({"type":"content_block_delta","index":0,"delta":delta})),
        ("content_block_stop", json!({"type":"content_block_stop","index":0})),
        ("message_delta", json!({"type":"message_delta","delta":{"stop_reason":reason},"usage":{"output_tokens":5}})),
        ("message_stop", json!({"type":"message_stop"})),
    ].iter().map(|(name, data)| format!("event: {name}\ndata: {data}\n\n")).collect()
}

fn result_block<'a>(body: &'a Value, id: &str) -> Option<&'a Value> {
    body["messages"]
        .as_array()?
        .iter()
        .filter_map(|m| m["content"].as_array())
        .flatten()
        .find(|block| block["type"] == "tool_result" && block["tool_use_id"] == id)
}

#[test]
fn model_controls_task_and_team_lifecycle() {
    run_task_lifecycle(false);
}

#[test]
#[ignore = "上游 TaskList 的模型工具结果尚未包含任务明细"]
fn model_can_read_task_list_details() {
    run_task_lifecycle(true);
}

fn run_task_lifecycle(require_list_details: bool) {
    let task_id = Arc::new(AtomicU64::new(0));
    let responder_id = task_id.clone();
    let stop_id = Arc::new(AtomicU64::new(0));
    let responder_stop_id = stop_id.clone();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    let provider = runtime.block_on(async {
        let server = MockServer::start().await;
        Mock::given(method("POST")).and(path("/v1/messages"))
            .respond_with(move |request: &Request| {
                let body: Value = serde_json::from_slice(&request.body).unwrap();
                let text = String::from_utf8_lossy(&request.body);
                let step = (0..14).filter_map(|n| text.rfind(&format!("task-step-{n}")).map(|pos| (pos, n))).max().unwrap().1;
                let id = format!("lifecycle_tool_{step}");
                let task = responder_id.load(Ordering::SeqCst);
                let (name, args) = match step {
                    0 => ("TaskClaim", json!({"claimerId":"worker-one"})),
                    1 => ("TaskRelease", json!({"taskId":task})),
                    2 => ("TaskClaim", json!({"claimerId":"worker-two"})),
                    3 => ("TaskUpdate", json!({"taskId":task,"status":"completed"})),
                    4 => ("TaskRelease", json!({"taskId":task})),
                    5 => ("TeamCreate", json!({"name":"runtime-team","members":[{"agent_id":"builder@runtime-team","name":"builder"}]})),
                    6 => ("TeamDelete", json!({"name":"runtime-team"})),
                    7 => ("TaskGet", json!({"taskId":task})),
                    8 => ("TaskList", json!({"statusFilter":"completed"})),
                    9 => ("TaskOutput", json!({"taskId":task,"block":false})),
                    10 => ("TaskStop", json!({"taskId":task})),
                    11 => ("TodoWrite", json!({"todos":[{"content":"runtime checklist item","status":"in_progress","activeForm":"working"}]})),
                    12 | 13 => ("TaskStop", json!({"taskId":responder_stop_id.load(Ordering::SeqCst)})),
                    _ => unreachable!(),
                };
                let payload = if result_block(&body, &id).is_some() { stream(None) } else { stream(Some((&id, name, args))) };
                ResponseTemplate::new(200).set_body_raw(payload, "text/event-stream")
            }).mount(&server).await;
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
    let session = common::invoke_ok("reflect_create_session", json!({}));
    common::invoke_ok("reflect_bind_session", json!({"id":session}));
    common::invoke_ok("reflect_set_permission_mode", json!({"mode":"auto"}));
    let task = common::invoke_ok(
        "reflect_create_task",
        json!({"list":session,"subject":"agent-lifecycle-task","description":"integration"}),
    );
    let id = task["id"].as_u64().unwrap();
    std::fs::write(task["output_path"].as_str().unwrap(), "runtime task output").unwrap();
    task_id.store(id, Ordering::SeqCst);
    for step in 0..14 {
        if step == 12 {
            let running = common::invoke_ok(
                "reflect_create_task",
                json!({"list":session,"subject":"stop target","description":"integration","owner":"worker"}),
            );
            let running_id = running["id"].as_u64().unwrap();
            stop_id.store(running_id, Ordering::SeqCst);
            common::invoke_ok(
                "reflect_update_task",
                json!({"list":session,"id":running_id,"patch":{"status":"in_progress"}}),
            );
        }
        let submission = format!("task-turn-{step}");
        let tool_id = format!("lifecycle_tool_{step}");
        common::invoke_ok(
            "reflect_submit",
            json!({"submission":{"id":submission,"op":{"type":"user_input","items":[{"type":"text","text":format!("task-step-{step}")}]}}}),
        );
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut seen = Vec::new();
        loop {
            let event = rx
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .unwrap_or_else(|_| panic!("step {step} timed out: {seen:#?}"));
            if event["id"] == submission && event["msg"]["type"] == "turn_complete" {
                break;
            }
            if event["id"] == submission && event["msg"]["type"] == "approval_request" {
                assert!(
                    !seen
                        .iter()
                        .any(|prior: &Value| prior["msg"]["type"] == "tool_call_end"
                            && prior["msg"]["call_id"] == tool_id)
                );
                common::invoke_ok(
                    "reflect_tool_approval",
                    json!({"id":event["msg"]["request_id"],"decision":"approve"}),
                );
            }
            seen.push(event);
        }
        let end = seen
            .iter()
            .find(|event| {
                event["msg"]["type"] == "tool_call_end" && event["msg"]["call_id"] == tool_id
            })
            .unwrap_or_else(|| panic!("missing tool result step {step}: {seen:#?}"));
        if [3, 5, 6, 10, 12, 13].contains(&step) {
            assert!(
                seen.iter()
                    .any(|event| event["id"] == submission
                        && event["msg"]["type"] == "approval_request"),
                "missing approval for step {step}: {seen:#?}"
            );
        }
        let is_error = [4, 10, 13].contains(&step);
        assert_eq!(end["msg"]["is_error"], is_error, "step {step}: {end}");
        let requests = runtime.block_on(provider.received_requests()).unwrap();
        let model_result = requests
            .iter()
            .filter_map(|r| serde_json::from_slice::<Value>(&r.body).ok())
            .find_map(|body| result_block(&body, &tool_id).cloned())
            .expect("tool result did not reach model");
        assert_eq!(
            model_result["is_error"], is_error,
            "step {step}: {model_result}"
        );
        if step <= 4 {
            let current = common::invoke_ok("reflect_get_task", json!({"list":session,"id":id}));
            match step {
                0 => {
                    assert_eq!(current["status"], "in_progress");
                    assert_eq!(current["claimed_by"], "worker-one");
                }
                1 => {
                    assert_eq!(current["status"], "pending");
                    assert!(current["claimed_by"].is_null());
                }
                2 => {
                    assert_eq!(current["status"], "in_progress");
                    assert_eq!(current["claimed_by"], "worker-two");
                }
                3 | 4 => assert_eq!(
                    current["status"], "completed",
                    "release must not resurrect completed tasks"
                ),
                _ => unreachable!(),
            }
        } else if step == 5 {
            let team = common::invoke_ok("reflect_get_team", json!({"name":"runtime-team"}));
            let members = team["members"].as_array().unwrap();
            assert!(
                members
                    .iter()
                    .any(|m| m["agent_id"] == "builder@runtime-team")
            );
            assert!(
                members
                    .iter()
                    .any(|m| m["agent_id"] == "team-lead@runtime-team")
            );
            common::invoke_ok(
                "reflect_create_task",
                json!({"list":"runtime-team","subject":"team task remains","description":"delete must preserve tasks"}),
            );
        } else if step == 6 {
            let teams = common::invoke_ok("reflect_list_teams", json!({}));
            assert!(
                !teams
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|t| t["name"] == "runtime-team")
            );
            let tasks = common::invoke_ok("reflect_list_tasks", json!({"list":"runtime-team"}));
            assert!(
                tasks
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|task| task["subject"] == "team task remains"),
                "deleting team removed its task list: {tasks}"
            );
        } else {
            match step {
                7 => assert_eq!(
                    end["msg"]["output"]["metadata"]["task"]["subject"],
                    "agent-lifecycle-task"
                ),
                8 => {
                    assert_eq!(end["msg"]["output"]["metadata"]["count"], 1);
                    if require_list_details {
                        assert!(
                            model_result.to_string().contains("agent-lifecycle-task"),
                            "model cannot see task details: {model_result}"
                        );
                    }
                }
                9 => {
                    assert!(model_result.to_string().contains("runtime task output"));
                    assert_eq!(
                        common::invoke_ok(
                            "reflect_get_task_output",
                            json!({"list":session,"id":id})
                        ),
                        "runtime task output"
                    );
                }
                10 => assert_eq!(
                    common::invoke_ok("reflect_get_task", json!({"list":session,"id":id}))["status"],
                    "completed"
                ),
                11 => assert_eq!(
                    end["msg"]["output"]["metadata"]["todos"][0]["content"],
                    "runtime checklist item"
                ),
                12 | 13 => {
                    let stopped = common::invoke_ok(
                        "reflect_get_task",
                        json!({"list":session,"id":stop_id.load(Ordering::SeqCst)}),
                    );
                    assert_eq!(stopped["status"], "pending");
                    assert!(stopped["owner"].is_null() && stopped["claimed_by"].is_null());
                }
                _ => unreachable!(),
            }
        }
    }
}
