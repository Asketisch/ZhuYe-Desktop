//! 真实模型回合后执行回退，验证事件与持久化截断一致。
mod common;

use std::sync::mpsc::{Receiver, channel};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn reply(marker: &str) -> String {
    [
        (
            "message_start",
            json!({"type":"message_start","message":{"id":marker,"model":"claude-mock","usage":{"input_tokens":5}}}),
        ),
        (
            "content_block_start",
            json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}),
        ),
        (
            "content_block_delta",
            json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":format!("completed {marker}")}}),
        ),
        ("content_block_stop", json!({"type":"content_block_stop","index":0})),
        (
            "message_delta",
            json!({"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}),
        ),
        ("message_stop", json!({"type":"message_stop"})),
    ]
    .iter()
    .map(|(name, data)| format!("event: {name}\ndata: {data}\n\n"))
    .collect()
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

fn run_turn(rx: &Receiver<Value>, seen: &mut Vec<Value>, id: &str, marker: &str) -> String {
    common::invoke_ok(
        "zhuye_submit",
        json!({"submission":{"id":id,"op":{"type":"user_input","items":[{"type":"text","text":marker}]}}}),
    );
    let started = wait_for(rx, seen, |event| {
        event["id"] == id && event["msg"]["type"] == "turn_started"
    });
    wait_for(rx, seen, |event| {
        event["id"] == id && event["msg"]["type"] == "turn_complete"
    });
    started["msg"]["turn_id"].as_str().unwrap().to_string()
}

fn rewind_truncates_target_and_later_turns_from_rollout() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    let provider = runtime.block_on(async {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .respond_with(
                ResponseTemplate::new(200).set_body_raw(reply("rewind"), "text/event-stream"),
            )
            .mount(&server)
            .await;
        server
    });
    common::set_config_before_install(&format!(
        r#"[active]
provider = "anthropic"
[anthropic]
api_key = "test-key"
base_url = "{}"
model = "claude-mock"
[hooks]
enabled = []

[compact]
# 上游 v1.12 起 smart_prune 内部阈值继承本值(见下方循环注释的
# 「末轮单次暴涨」设计):15k 让 31 轮小消息永不触发自动压缩,
# 而末轮 60k 字符输入 + force 双重触发后真实上下文 ≥ 阈值 → 真删。
trigger_tokens = 15000
"#,
        provider.uri()
    ));
    let (tx, rx) = channel::<Value>();
    common::listen("zhuye_event", move |event: tauri::Event| {
        if let Ok(value) = serde_json::from_str(event.payload()) {
            let _ = tx.send(value);
        }
    });
    let session = common::invoke_ok("zhuye_create_session", json!({}));
    common::invoke_ok("zhuye_bind_session", json!({"id":session}));

    let mut seen = Vec::new();
    let first = run_turn(&rx, &mut seen, "rewind-first", "rewind-first-marker");
    let second = run_turn(&rx, &mut seen, "rewind-second", "rewind-second-marker");
    assert_ne!(first, second);

    let before = common::invoke_ok("zhuye_replay_session", json!({"id":session}));
    let before_text = before.to_string();
    assert!(before_text.contains("rewind-first-marker"), "{before}");
    assert!(before_text.contains("rewind-second-marker"), "{before}");
    let before_count = before.as_array().map(Vec::len).unwrap_or_default();

    let rewind_id = common::invoke_ok("zhuye_rewind", json!({"toTurnId":first}));
    let rewound = wait_for(&rx, &mut seen, |event| {
        event["id"] == rewind_id && event["msg"]["type"] == "turn_rewound"
    });
    assert!(
        rewound["msg"]["truncated_after"].as_u64().unwrap_or(0) > 0,
        "{rewound}"
    );

    let after = common::invoke_ok("zhuye_replay_session", json!({"id":session}));
    let after_text = after.to_string();
    assert!(!after_text.contains("rewind-first-marker"), "{after}");
    assert!(!after_text.contains("rewind-second-marker"), "{after}");
    assert!(
        after.as_array().map(Vec::len).unwrap_or_default() < before_count,
        "before: {before_count}, after: {after}"
    );
}

fn manual_compact_removes_old_context_before_next_model_call() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    let provider = runtime.block_on(async {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .respond_with(
                ResponseTemplate::new(200).set_body_raw(reply("compact"), "text/event-stream"),
            )
            .mount(&server)
            .await;
        server
    });
    common::set_config_before_install(&format!(
        r#"[active]
provider = "anthropic"
[anthropic]
api_key = "test-key"
base_url = "{}"
model = "claude-mock"
[hooks]
enabled = []

[compact]
# 上游 v1.12 起 smart_prune 内部阈值继承本值(见下方循环注释的
# 「末轮单次暴涨」设计):15k 让 31 轮小消息永不触发自动压缩,
# 而末轮 60k 字符输入 + force 双重触发后真实上下文 ≥ 阈值 → 真删。
trigger_tokens = 15000
"#,
        provider.uri()
    ));
    let (tx, rx) = channel::<Value>();
    common::listen("zhuye_event", move |event: tauri::Event| {
        if let Ok(value) = serde_json::from_str(event.payload()) {
            let _ = tx.send(value);
        }
    });
    let session = common::invoke_ok("zhuye_create_session", json!({}));
    common::invoke_ok("zhuye_bind_session", json!({"id":session}));

    let mut seen = Vec::new();
    // v1.12 压缩语义适配(eager auto-compaction):上游 v1.x 起 model_call
    // 每次成功调用后,reported 超阈值即**同轮**触发 smart_prune(不再等下
    // 一轮 pre_loop)—— 32 轮逐轮攒旧历史的旧设计会被中途自动压光。改为
    // 「31 轮小消息 + 1 轮大输入」:
    // - 前 31 轮小消息(累计 ~3k tokens,永不触 15k 阈值);
    // - 第 32 轮 user 单次高信息密度大文本(uuid 串 ~40k tokens ≥ 15000)
    //   → 该轮 model_call 后同轮触发真实压缩(strategy=smart_prune,
    //   after 回到阈值内);
    // - 手动 compact(受理 noop ack);
    // - compact-after 轮在压缩后的上下文上正常运行。
    // 断言组:首条钉住 / 大轮 60k+ 字符探测 uuid 被截断(不进后续请求)。
    for index in 0..31 {
        run_turn(
            &rx,
            &mut seen,
            &format!("compact-old-{index:02}"),
            &format!("compact-old-{index:02}"),
        );
    }
    let filler: Vec<String> = (0..3_333)
        .map(|_| uuid::Uuid::new_v4().to_string())
        .collect();
    let probe_uuid = filler[1_500].clone(); // 中段取样:截断后必不在请求里
    let big_text = format!("compact-old-31-{}", filler.join(""));
    run_turn(&rx, &mut seen, "compact-old-31", &big_text);

    let big_compacted = seen
        .iter()
        .find(|event| {
            event["id"] == "compact-old-31"
                && event["msg"]["type"] == "context_compacted"
                && event["msg"]["strategy"] != "noop"
        })
        .unwrap_or_else(|| panic!("大轮未见真实压缩事件(v1.12 eager 语义):{seen:#?}"));
    // removed_messages > 0:smart_prune 真实删除了旧轮(after_tokens 仍含
    // 大轮 uuid 文本——截断为主、删除为辅,阈值内不保证,不作为断言)。
    assert!(
        big_compacted["msg"]["removed_messages"]
            .as_u64()
            .unwrap_or(0)
            > 0,
        "压缩应真实删除旧轮:{big_compacted}"
    );

    let compact_id = common::invoke_ok("zhuye_compact", json!({}));
    let accepted = wait_for(&rx, &mut seen, |event| {
        event["id"] == compact_id && event["msg"]["type"] == "context_compacted"
    });
    assert_eq!(accepted["msg"]["strategy"], "noop", "{accepted}");

    run_turn(&rx, &mut seen, "compact-after", "compact-after-marker");

    let requests = runtime.block_on(provider.received_requests()).unwrap();
    let after_request = requests
        .iter()
        .find(|request| String::from_utf8_lossy(&request.body).contains("compact-after-marker"))
        .unwrap_or_else(|| panic!("next turn did not reach model: {requests:#?}"));
    let body = String::from_utf8_lossy(&after_request.body);
    // 压缩生效断言:大轮的高密度探测 uuid 被截断(不进后续请求);
    // 首轮钉住 / 尾部保留。
    assert!(
        !body.contains(&probe_uuid),
        "oversized final turn must be truncated: {} bytes",
        body.len()
    );
    assert!(
        body.contains("compact-old-00"),
        "first user is pinned: {body}"
    );
    assert!(
        body.contains("compact-after-marker"),
        "recent tail is retained: {body}"
    );
}

#[test]
fn rewind_and_manual_compact_change_real_runtime_state() {
    rewind_truncates_target_and_later_turns_from_rollout();
    manual_compact_removes_old_context_before_next_model_call();
}
