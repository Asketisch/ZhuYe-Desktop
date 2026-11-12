//! 能力覆盖层 · 假模型全链路 —— 真后端 + 真 AgentThread + 本地 mock LLM。
//!
//! 确定性验证 submit → AgentThread → HTTP → SSE 解析 → 事件回传
//! (delta / 工具调用 / 审批门 / token 统计 / turn 收尾)。
//!
//! 这里用 wiremock 在本机起一个假 Anthropic 网关(`[anthropic].base_url`
//! 指向它,离线、确定性),覆盖:
//!
//! 1. 纯文本回复:delta 累积 + token_count + turn_complete;
//! 2. 工具调用:bash tool_use → 审批门(`prompt` 模式)→ approve →
//!    工具真实执行(echo)→ 第二次请求带 tool_result → 最终回复;
//!    并断言恰好两次 HTTP 请求、非官方 base_url 走 `Authorization: Bearer`;
//! 3. HTTP 500:error 事件走同一 `reflect_event` 通道,turn 有终态;
//! 4. 流中中断:服务端延迟响应,`reflect_interrupt` 后 turn 终止且无 delta。
//! 5. 旁路代理:真实线程经本地模型返回摘要,另一个请求发出后取消并验证终态。
//!
//! 各场景经互斥锁**串行**(共享一个 AgentThread,`interrupt` 是全局的,
//! 并行会互相打断)。

mod common;

use std::sync::mpsc::{Receiver, channel};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde_json::{Value, json};
use wiremock::matchers::{body_string_contains, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

// ============================================================================
// SSE 构造 —— 事件形状与 `reflect-llm/src/providers/anthropic.rs` 的解析器对齐
// ============================================================================

fn sse(events: &[(&str, Value)]) -> String {
    events
        .iter()
        .map(|(ev, data)| format!("event: {ev}\ndata: {data}\n\n"))
        .collect()
}

fn message_start(input_tokens: u64) -> (&'static str, Value) {
    (
        "message_start",
        json!({
            "type": "message_start",
            "message": { "id": "msg_mock", "model": "claude-mock", "usage": { "input_tokens": input_tokens } }
        }),
    )
}

fn text_block_start() -> (&'static str, Value) {
    (
        "content_block_start",
        json!({ "type": "content_block_start", "index": 0, "content_block": { "type": "text", "text": "" } }),
    )
}

fn text_delta(text: &str) -> (&'static str, Value) {
    (
        "content_block_delta",
        json!({ "type": "content_block_delta", "index": 0, "delta": { "type": "text_delta", "text": text } }),
    )
}

fn message_tail(stop_reason: &str, output_tokens: u64) -> Vec<(&'static str, Value)> {
    vec![
        (
            "content_block_stop",
            json!({ "type": "content_block_stop", "index": 0 }),
        ),
        (
            "message_delta",
            json!({ "type": "message_delta", "delta": { "stop_reason": stop_reason }, "usage": { "output_tokens": output_tokens } }),
        ),
        ("message_stop", json!({ "type": "message_stop" })),
    ]
}

/// 纯文本回复的完整 SSE 流。
fn sse_text_reply(parts: &[&str]) -> String {
    let mut events = vec![message_start(10), text_block_start()];
    for p in parts {
        events.push(text_delta(p));
    }
    events.extend(message_tail("end_turn", 7));
    sse(&events)
}

/// tool_use 回复(bash echo),input_json 拆成两个分片验 partial_json 累积。
fn sse_tool_use() -> String {
    let events = vec![
        message_start(12),
        (
            "content_block_start",
            json!({
                "type": "content_block_start",
                "index": 0,
                "content_block": { "type": "tool_use", "id": "toolu_mock_bash", "name": "bash" }
            }),
        ),
        (
            "content_block_delta",
            json!({ "type": "content_block_delta", "index": 0, "delta": { "type": "input_json_delta", "partial_json": "{\"cmd\":" } }),
        ),
        (
            "content_block_delta",
            json!({ "type": "content_block_delta", "index": 0, "delta": { "type": "input_json_delta", "partial_json": "\"echo mock-provider-tool-ok\"}" } }),
        ),
        (
            "content_block_stop",
            json!({ "type": "content_block_stop", "index": 0 }),
        ),
        (
            "message_delta",
            json!({ "type": "message_delta", "delta": { "stop_reason": "tool_use" }, "usage": { "output_tokens": 9 } }),
        ),
        ("message_stop", json!({ "type": "message_stop" })),
    ];
    sse(&events)
}

fn sse_response(body: String) -> ResponseTemplate {
    // 必须用 `set_body_raw` 设类型：`set_body_string` 会把 content-type 覆盖成
    // `text/plain`，而核心的流式解析会拒绝「200 但不是 text/event-stream」。
    ResponseTemplate::new(200).set_body_raw(body, "text/event-stream")
}

// ============================================================================
// 共享世界:mock 网关 + 指向它的配置 + 已安装的 AgentThread
// ============================================================================

struct World {
    server: MockServer,
    /// mock server 所在的多线程 runtime(leak 存活);同步测试线程借它
    /// `block_on` 调 wiremock 的 async API(register / received_requests)。
    rt: &'static tokio::runtime::Runtime,
}

static WORLD: OnceLock<Mutex<World>> = OnceLock::new();

/// 幂等初始化:起 mock 网关 → 写配置 → 触发 `harness()`(安装 AgentThread)。
/// 返回的 MutexGuard 同时把四个场景**串行**起来(interrupt 是全局的)。
fn world() -> std::sync::MutexGuard<'static, World> {
    let cell = WORLD.get_or_init(|| {
        // 多线程 runtime 供 mock server 长期运行;leak 让它活到进程退出。
        let rt: &'static tokio::runtime::Runtime = Box::leak(Box::new(
            tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
                .expect("build mock-server runtime"),
        ));
        let server = rt.block_on(async {
            let server = MockServer::start().await;

            // —— 场景一:纯文本回复 ——
            server
                .register(
                    Mock::given(method("POST"))
                        .and(path("/v1/messages"))
                        .and(body_string_contains("mock-provider-scene-one"))
                        .respond_with(sse_response(sse_text_reply(&["mock provider says ", "hello"]))),
                )
                .await;

            // —— 场景二:工具调用,两跳。第一/第二次请求都含场景关键词,
            // 但只有第二次含 tool_result —— 第二跳 matcher 用最高优先级(1)
            // 先被检查。
            server
                .register(
                    Mock::given(method("POST"))
                        .and(path("/v1/messages"))
                        .and(body_string_contains("mock-provider-scene-two"))
                        .respond_with(sse_response(sse_tool_use())),
                )
                .await;
            server
                .register(
                    Mock::given(method("POST"))
                        .and(path("/v1/messages"))
                        .and(body_string_contains("mock-provider-tool-ok"))
                        .and(body_string_contains("tool_result"))
                        .respond_with(sse_response(sse_text_reply(&["tool round done"])))
                        .with_priority(1),
                )
                .await;

            // —— 场景三:HTTP 500 ——
            server
                .register(
                    Mock::given(method("POST"))
                        .and(path("/v1/messages"))
                        .and(body_string_contains("mock-provider-scene-three"))
                        .respond_with(
                            ResponseTemplate::new(500).set_body_string(
                                "{\"type\":\"error\",\"error\":{\"type\":\"api_error\",\"message\":\"mock provider exploded\"}}",
                            ),
                        ),
                )
                .await;

            // —— 场景四:延迟 25s 的回复(给 interrupt 留窗口)——
            server
                .register(
                    Mock::given(method("POST"))
                        .and(path("/v1/messages"))
                        .and(body_string_contains("mock-provider-scene-four"))
                        .respond_with(
                            sse_response(sse_text_reply(&["too late"]))
                                .set_delay(Duration::from_secs(25)),
                        ),
                )
                .await;

            // Side-channel 使用同一真实模型注册表，但由独立 AgentThread 执行。
            server
                .register(
                    Mock::given(method("POST"))
                        .and(path("/v1/messages"))
                        .and(body_string_contains("mock-side-channel-success"))
                        .respond_with(sse_response(sse_text_reply(&["side channel result verified"]))),
                )
                .await;
            server
                .register(
                    Mock::given(method("POST"))
                        .and(path("/v1/messages"))
                        .and(body_string_contains("mock-side-channel-cancel"))
                        .respond_with(
                            sse_response(sse_text_reply(&["cancelled result must not arrive"]))
                                .set_delay(Duration::from_secs(20)),
                        ),
                )
                .await;

            server
        });

        let config = format!(
            "# mock provider 全链路配置\n[active]\nprovider = \"anthropic\"\n\n[anthropic]\napi_key = \"test-key\"\nbase_url = \"{}\"\nmodel = \"claude-mock\"\n\n[hooks]\nenabled = []\n",
            server.uri()
        );
        common::set_config_before_install(&config);
        // 触发安装(读取上面的配置建 ModelRegistry / 起 AgentThread)。
        drop(common::harness());
        Mutex::new(World { server, rt })
    });
    cell.lock().unwrap_or_else(|e| e.into_inner())
}

// ============================================================================
// 事件采集(与 ipc_events.rs 同款:按内容匹配,不按数量)
// ============================================================================

fn collect_events() -> Receiver<Value> {
    let (tx, rx) = channel();
    common::listen("reflect_event", move |event: tauri::Event| {
        if let Ok(v) = serde_json::from_str::<Value>(event.payload()) {
            let _ = tx.send(v);
        }
    });
    rx
}

fn msg_type(e: &Value) -> Option<&str> {
    e.get("msg")
        .and_then(|m| m.get("type"))
        .and_then(|t| t.as_str())
}

fn event_id(e: &Value) -> &str {
    e.get("id").and_then(|v| v.as_str()).unwrap_or_default()
}

fn submit(submission_id: &str, text: &str) {
    common::invoke_ok(
        "reflect_submit",
        json!({
            "submission": {
                "id": submission_id,
                "op": { "type": "user_input", "items": [{ "type": "text", "text": text }] },
            }
        }),
    );
}

/// 等到满足 `pred` 的事件;期间路过的所有事件都记录进 `seen`。
fn wait_until_seen<F>(
    rx: &Receiver<Value>,
    pred: F,
    timeout: Duration,
    seen: &mut Vec<Value>,
) -> Option<Value>
where
    F: Fn(&Value) -> bool,
{
    let deadline = std::time::Instant::now() + timeout;
    loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return None;
        }
        match rx.recv_timeout(remaining.min(Duration::from_millis(200))) {
            Ok(v) => {
                if pred(&v) {
                    return Some(v);
                }
                seen.push(v);
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return None,
        }
    }
}

/// 收到的 `/v1/messages` 请求快照。
fn messages_requests(w: &World) -> Vec<wiremock::Request> {
    w.rt.block_on(w.server.received_requests())
        .unwrap_or_default()
        .into_iter()
        .filter(|r| r.url.path() == "/v1/messages")
        .collect()
}

// ============================================================================
// 场景(单个 #[test] 顺序执行 —— 共享一个 AgentThread,顺序固定才确定;
// 全局状态(permission mode / interrupt)不会互相打架)
// ============================================================================

/// 场景一:纯文本回复 —— delta 累积 + token_count + turn_complete。
fn scene_one_plain_text() {
    let rx = collect_events();
    let id = "mock-provider-sub-1";
    submit(id, "mock-provider-scene-one plain text");

    let mut seen = Vec::new();
    let complete = wait_until_seen(
        &rx,
        |e| msg_type(e) == Some("turn_complete") && event_id(e) == id,
        Duration::from_secs(60),
        &mut seen,
    )
    .unwrap_or_else(|| {
        panic!(
            "场景一:没有等 turn_complete。seen {} 条事件:{}",
            seen.len(),
            event_summary(&seen)
        )
    });

    let text: String = seen
        .iter()
        .filter(|e| event_id(e) == id && msg_type(e) == Some("agent_message_delta"))
        .filter_map(|e| e["msg"]["delta"].as_str())
        .collect();
    assert!(
        text.contains("mock provider says hello"),
        "场景一 delta 累积不符: {text:?}"
    );

    // token 统计来自 SSE usage(message_start.input_tokens=10)。
    let tokens = seen
        .iter()
        .find(|e| event_id(e) == id && msg_type(e) == Some("token_count"))
        .expect("场景一:没有 token_count 事件");
    assert_eq!(
        tokens["msg"]["input_tokens"],
        json!(10),
        "token_count: {tokens}"
    );

    assert!(
        complete["msg"]["turn_id"].is_string(),
        "turn_complete 缺 turn_id: {complete}"
    );
}

/// 场景二:工具调用全链路 —— tool_use → 审批门(prompt 模式)→ approve →
/// bash 真实执行 → 第二跳(tool_result)→ 最终回复。
fn scene_two_tool_use(w: &World) {
    // 「prompt」模式确保工具执行前有审批门 —— 全链路里最常被模拟层遮住的一段。
    // (默认是 auto:见 session_configured.approval_policy。)
    common::invoke_ok("reflect_set_permission_mode", json!({ "mode": "prompt" }));

    let rx = collect_events();
    let id = "mock-provider-sub-2";
    let before = messages_requests(w).len();
    submit(id, "mock-provider-scene-two run the tool");

    let mut seen = Vec::new();
    // 1) 审批门:approval_request(bash);完整工具参数在 kind.args。
    let approval = wait_until_seen(
        &rx,
        |e| {
            msg_type(e) == Some("approval_request")
                && e["msg"]["kind"]["type"] == json!("tool")
                && e["msg"]["kind"]["tool_name"] == json!("bash")
        },
        Duration::from_secs(60),
        &mut seen,
    )
    .unwrap_or_else(|| {
        panic!(
            "场景二:没有等到 bash 的 approval_request。seen {} 条事件:{}",
            seen.len(),
            event_summary(&seen)
        )
    });
    let request_id = approval["msg"]["request_id"]
        .as_str()
        .expect("approval_request 缺 request_id")
        .to_string();
    assert!(
        approval["msg"]["kind"]["args"]["cmd"]
            .as_str()
            .unwrap_or_default()
            .contains("echo mock-provider-tool-ok"),
        "审批载荷里的 bash 参数与 tool_use 不符: {approval}"
    );

    // 2) 放行。
    common::invoke_ok(
        "reflect_tool_approval",
        json!({ "id": request_id, "decision": "approve" }),
    );

    // 3) 工具真实执行 + 第二跳回复 + turn 收尾。
    let mut seen2 = Vec::new();
    let complete = wait_until_seen(
        &rx,
        |e| msg_type(e) == Some("turn_complete") && event_id(e) == id,
        Duration::from_secs(60),
        &mut seen2,
    )
    .unwrap_or_else(|| {
        panic!(
            "场景二:审批后没有等 turn_complete。seen {} 条事件:{}",
            seen2.len(),
            event_summary(&seen2)
        )
    });

    // tool_call_begin 的 args 在流开始时还是 null(参数经 input_json_delta
    // 累积,完整值在审批载荷里 —— 上面已断言);这里只断言工具名。
    let begin = seen2
        .iter()
        .chain(seen.iter())
        .find(|e| event_id(e) == id && msg_type(e) == Some("tool_call_begin"))
        .expect("场景二:没有 tool_call_begin");
    assert_eq!(
        begin["msg"]["tool_name"],
        json!("bash"),
        "tool_call_begin: {begin}"
    );
    assert!(
        seen2
            .iter()
            .any(|e| event_id(e) == id && msg_type(e) == Some("tool_call_end")),
        "场景二:没有 tool_call_end"
    );

    let text: String = seen2
        .iter()
        .filter(|e| event_id(e) == id && msg_type(e) == Some("agent_message_delta"))
        .filter_map(|e| e["msg"]["delta"].as_str())
        .collect();
    assert!(
        text.contains("tool round done"),
        "场景二最终回复不符: {text:?}"
    );

    // 4) HTTP 侧:恰好两次请求;第二跳带 tool_result;非官方 base_url 走 Bearer。
    let messages = messages_requests(w);
    assert_eq!(
        messages.len() - before,
        2,
        "工具往返应恰好发起两次 /v1/messages 请求"
    );
    assert!(
        messages
            .iter()
            .all(|r| r.headers.contains_key("authorization")),
        "自定义 base_url 应走 Authorization: Bearer(第三方网关兼容分支)"
    );
    let second = messages.last().expect("第二次请求");
    let body = String::from_utf8_lossy(&second.body);
    assert!(
        body.contains("tool_result"),
        "第二跳请求体应含 tool_result: {body}"
    );
    assert!(
        body.contains("mock-provider-tool-ok"),
        "第二跳请求体应含工具输出: {body}"
    );
    assert!(complete["msg"]["turn_id"].is_string());

    // 还原全局审批策略,别影响后续场景。
    common::invoke_ok("reflect_set_permission_mode", json!({ "mode": "auto" }));
}

/// 场景三:HTTP 500 —— error 事件走同一 `reflect_event` 通道;核心对
/// 异常取消(error / cancel)走「静默丢弃分支」(submission_loop.rs 注释
/// 明示),即 **error 之后没有 turn 终态事件** —— 这里照实断言该口径,
/// 并验证 agent 循环未被失败卡死(后续提交照常完成)。
fn scene_three_provider_500() {
    let rx = collect_events();
    let id = "mock-provider-sub-3";
    submit(id, "mock-provider-scene-three trigger failure");

    let mut seen = Vec::new();
    let err = wait_until_seen(
        &rx,
        |e| msg_type(e) == Some("error") && event_id(e) == id,
        Duration::from_secs(60),
        &mut seen,
    )
    .expect("场景三:没有等到与提交配对的 error 事件");
    assert!(
        err["msg"]["code"].as_str().is_some_and(|c| !c.is_empty())
            || err["msg"]["message"]
                .as_str()
                .is_some_and(|m| !m.is_empty()),
        "error 事件缺少 code/message: {err}"
    );
    // 失败路径不产出任何正文。
    let deltas = seen
        .iter()
        .filter(|e| event_id(e) == id && msg_type(e) == Some("agent_message_delta"))
        .count();
    assert_eq!(deltas, 0, "场景三:失败路径不应有 delta");

    // agent 未被失败卡死:同会话再发一条,必须收到**与该提交配对**的响应
    // 事件(可能是 turn_complete,也可能是凭证冷却后的
    // ALL_CREDENTIALS_EXHAUSTED error —— 两者都证明循环还活着)。
    let id2 = "mock-provider-sub-3-recovery";
    submit(id2, "mock-provider-scene-one recovery after error");
    let mut seen2 = Vec::new();
    let recovery = wait_until_seen(
        &rx,
        |e| {
            event_id(e) == id2
                && matches!(
                    msg_type(e),
                    Some("turn_complete") | Some("error") | Some("agent_message_delta")
                )
        },
        Duration::from_secs(60),
        &mut seen2,
    )
    .unwrap_or_else(|| {
        panic!(
            "场景三:provider 失败后 agent 循环卡死(恢复提交无响应)。seen {} 条事件:{}",
            seen2.len(),
            event_summary(&seen2)
        )
    });
    assert_ne!(
        msg_type(&recovery),
        Some("agent_message_delta"),
        "恢复提交不应只收到 delta 而无终态/错误"
    );
}

/// 场景四:流中中断 —— 25s 延迟的回复被 `reflect_interrupt` 取消;
/// 当前核心语义:中断以 `error`(code=CANCELLED)回到同一通道,turn 无
/// 终态事件(同场景三的静默丢弃分支),且不得有任何 delta 泄出。
fn scene_four_interrupt() {
    let rx = collect_events();
    let id = "mock-provider-sub-4";
    submit(id, "mock-provider-scene-four slow reply");

    // 等 turn 真正开始(说明请求已发出),再中断。
    let mut seen = Vec::new();
    wait_until_seen(
        &rx,
        |e| msg_type(e) == Some("turn_started") && event_id(e) == id,
        Duration::from_secs(30),
        &mut seen,
    )
    .expect("场景四:没有 turn_started");
    common::invoke_ok("reflect_interrupt", json!({}));

    let mut seen2 = Vec::new();
    // 中断的收尾有两条竞态路径(取决于取消信号先落在哪一层):
    //   a) 模型调用层把它当错误 → `error`(code=CANCELLED);
    //   b) 回合任务的取消分支 → `turn_aborted`(reason=user_interrupt)。
    // 两者都证明取消已传播到该提交 —— 接受任一,并校验其内容。
    let cancelled = wait_until_seen(
        &rx,
        |e| {
            event_id(e) == id
                && (msg_type(e) == Some("turn_aborted")
                    || (msg_type(e) == Some("error") && e["msg"]["code"] == json!("CANCELLED")))
        },
        Duration::from_secs(30),
        &mut seen2,
    )
    .unwrap_or_else(|| {
        panic!(
            "场景四:interrupt 后既无 CANCELLED error 也无 turn_aborted。seen {} 条事件:{}",
            seen2.len(),
            event_summary(&seen2)
        )
    });
    match msg_type(&cancelled) {
        Some("error") => assert_eq!(
            cancelled["msg"]["code"],
            json!("CANCELLED"),
            "中断 error 的 code 应为 CANCELLED: {cancelled}"
        ),
        Some("turn_aborted") => assert_eq!(
            cancelled["msg"]["reason"]["type"],
            json!("user_interrupt"),
            "turn_aborted 的原因应为 user_interrupt: {cancelled}"
        ),
        other => panic!("场景四:意外的收尾事件类型 {other:?}: {cancelled}"),
    }
    // 25s 延迟的回复不可能在中断后继续流出 —— delta 一条都不该有。
    let deltas = seen2
        .iter()
        .chain(seen.iter())
        .filter(|e| event_id(e) == id && msg_type(e) == Some("agent_message_delta"))
        .count();
    assert_eq!(deltas, 0, "场景四:中断后仍收到 {deltas} 条 delta");

    // 中断后 agent 仍可用:新提交必须收到配对的响应(turn_complete 或
    // 凭证冷却 error 均可 —— 都证明循环活着)。
    let id2 = "mock-provider-sub-4-recovery";
    submit(id2, "mock-provider-scene-one recovery after interrupt");
    let mut seen3 = Vec::new();
    wait_until_seen(
        &rx,
        |e| {
            event_id(e) == id2
                && matches!(
                    msg_type(e),
                    Some("turn_complete") | Some("error") | Some("agent_message_delta")
                )
        },
        Duration::from_secs(60),
        &mut seen3,
    )
    .unwrap_or_else(|| {
        panic!(
            "场景四:interrupt 后 agent 循环卡死(恢复提交无响应)。seen {} 条事件:{}",
            seen3.len(),
            event_summary(&seen3)
        )
    });
}

/// 真实旁路线程经本地模型完成并回传摘要；另一次在请求发出后取消。
fn scene_side_channel(w: &World) {
    let rx = collect_events();
    let started = common::invoke_ok(
        "reflect_start_side_channel",
        json!({ "agentName": "desktop-side-test", "prompt": "mock-side-channel-success" }),
    );
    let id = started["id"].as_str().unwrap();
    let mut seen = Vec::new();
    let finished = wait_until_seen(
        &rx,
        |e| {
            msg_type(e) == Some("side_channel_finished")
                && e["msg"]["id"] == id
                && e["msg"]["kind"] == "done"
        },
        Duration::from_secs(60),
        &mut seen,
    )
    .unwrap_or_else(|| panic!("旁路 agent 未完成: {}", event_summary(&seen)));
    assert_eq!(event_id(&finished), "");
    assert_eq!(finished["msg"]["summary"], "side channel result verified");
    let status = common::invoke_ok("reflect_get_side_channel", json!({ "id": id }));
    assert_eq!(status["status"], "done");
    assert!(messages_requests(w).iter().any(|request| {
        String::from_utf8_lossy(&request.body).contains("mock-side-channel-success")
    }));

    let cancelled = common::invoke_ok(
        "reflect_start_side_channel",
        json!({ "agentName": "desktop-side-test", "prompt": "mock-side-channel-cancel" }),
    );
    let cancelled_id = cancelled["id"].as_str().unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    while !messages_requests(w)
        .iter()
        .any(|request| String::from_utf8_lossy(&request.body).contains("mock-side-channel-cancel"))
    {
        assert!(std::time::Instant::now() < deadline, "旁路模型请求未发出");
        std::thread::sleep(Duration::from_millis(50));
    }
    assert_eq!(
        common::invoke_ok("reflect_cancel_side_channel", json!({ "id": cancelled_id })),
        true
    );
    let mut seen_cancel = Vec::new();
    let terminal = wait_until_seen(
        &rx,
        |e| msg_type(e) == Some("side_channel_finished") && e["msg"]["id"] == cancelled_id,
        Duration::from_secs(30),
        &mut seen_cancel,
    )
    .unwrap_or_else(|| panic!("旁路取消无终态: {}", event_summary(&seen_cancel)));
    assert_eq!(terminal["msg"]["kind"], "cancelled", "{terminal}");
    assert_eq!(event_id(&terminal), "");
    let status = common::invoke_ok("reflect_get_side_channel", json!({ "id": cancelled_id }));
    assert_eq!(status["status"], "cancelled");
    assert_eq!(
        common::invoke_ok("reflect_cancel_side_channel", json!({ "id": cancelled_id })),
        false
    );
}

fn event_summary(events: &[Value]) -> String {
    events
        .iter()
        .map(|e| {
            format!(
                "{}#{} {}",
                msg_type(e).unwrap_or("?"),
                event_id(e),
                // error 事件不截断：截掉 payload 等于截掉唯一的诊断线索。
                if msg_type(e) == Some("error") {
                    e["msg"].to_string()
                } else {
                    e["msg"].to_string().chars().take(120).collect::<String>()
                }
            )
        })
        .collect::<Vec<_>>()
        .join("\n  ")
}

#[test]
fn mock_provider_full_chain_scenarios() {
    let w = world();
    scene_one_plain_text();
    scene_two_tool_use(&w);
    scene_side_channel(&w);
    // 顺序敏感:中断(Cancelled → GiveUp)不冷却凭证;而 500 会把唯一
    // 凭证放进冷却(Cap 1h),之后再发的场景只会拿到
    // ALL_CREDENTIALS_EXHAUSTED —— 所以 500 场景放最后。
    scene_four_interrupt();
    scene_three_provider_500();
}
