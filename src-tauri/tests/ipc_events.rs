//! 能力覆盖层 · 事件回传通路 —— 真实命令体 over 真实 IPC 通路。
//!
//! 这一层盯的是**链路最后一环**:agent 产生的事件 → session broadcast →
//! Tauri `reflect_event` 通道 → 前端。前端 `src/services/agentEventBus.ts`
//! 订阅的就是这个通道,`src/stores/agent/reducer.ts` 按 `msg.type` 分派。
//!
//! ## 为什么值得单独一层
//!
//! 前面几层验的是「命令进得来、结果出得去」;这一层验的是
//! **事件**的线上形状 —— 而 `AGENTS.md` 里写死的协议不变量正好落在这里:
//!
//! - 线格式为 `reflect_protocol::Event`(snake_case JSON);
//! - Submission id ↔ Event id 配对用于流关联;
//! - `EVENT_ID_NONE = ""` 用于生命周期事件(无匹配提交)。
//!
//! 这三条破了**不会报错**,只会让前端静默地不更新 —— 正是最该被门禁盯住
//! 的那一类。

mod common;

use std::sync::mpsc::{Receiver, Sender, channel};
use std::time::Duration;

use serde_json::Value;

use common::{invoke_ok, listen};

/// 订阅 `reflect_event`,把每个事件的**线上载荷**收进队列。
fn collect_events() -> Receiver<Value> {
    let (tx, rx): (Sender<Value>, Receiver<Value>) = channel();
    // 用夹具的 `listen` 助手而不是直接攥着 `harness()` 的守卫 ——
    // 后者跨 `invoke` 会死锁。
    listen("reflect_event", move |event: tauri::Event| {
        // 载荷是 serde_json::Value —— 与前端 `onReflectEvent` 收到的一致。
        if let Ok(v) = serde_json::from_str::<Value>(event.payload()) {
            let _ = tx.send(v);
        }
    });
    rx
}

/// 提交一条用户输入(与前端 Composer 走同一条命令),返回 submission id。
fn submit(submission_id: &str, text: &str) {
    invoke_ok(
        "reflect_submit",
        serde_json::json!({
            "submission": {
                "id": submission_id,
                "op": { "type": "user_input", "items": [{ "type": "text", "text": text }] },
            }
        }),
    );
}

/// 等到收到满足 `pred` 的事件,或超时。
///
/// **必须按内容匹配,不能只按数量**:
///   1. `session_configured` 先到,`turn_started` / `error` 后到 —— 只等
///      「第一个事件」会拿到错的;
///   2. 四个用例并行跑,事件会**互相串到对方的队列**里 —— 所以还得按
///      submission id 过滤,只认自己那次提交的事件。
fn wait_until<F>(rx: &Receiver<Value>, pred: F, timeout: Duration) -> Option<Value>
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
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return None,
        }
    }
}

/// 事件类型判别子。
fn msg_type(e: &Value) -> Option<&str> {
    e.get("msg")
        .and_then(|m| m.get("type"))
        .and_then(|t| t.as_str())
}

/// 事件 id(空串 = `EVENT_ID_NONE`)。
fn event_id(e: &Value) -> &str {
    e.get("id").and_then(|v| v.as_str()).unwrap_or_default()
}

#[test]
fn events_arrive_with_the_reflect_event_envelope() {
    let rx = collect_events();
    let submission_id = "capability-event-sub-1";
    submit(submission_id, "事件信封探针");

    // 等一个属于本次提交的 per-turn 事件。
    let event = wait_until(
        &rx,
        |e| event_id(e) == submission_id && msg_type(e).is_some(),
        Duration::from_secs(20),
    )
    .expect("提交后没有任何事件到达 reflect_event 通道");

    // 信封形状:{ id: string, msg: { type: string, ... } }
    assert!(
        event.get("id").and_then(|v| v.as_str()).is_some(),
        "事件缺少字符串 id 字段: {event}"
    );
    let msg = event
        .get("msg")
        .and_then(|v| v.as_object())
        .unwrap_or_else(|| panic!("事件缺少 msg 对象: {event}"));
    assert!(
        msg.get("type").and_then(|v| v.as_str()).is_some(),
        "msg 缺少判别子 type: {event}"
    );
}

#[test]
fn lifecycle_event_uses_the_none_id() {
    let rx = collect_events();
    submit("capability-event-sub-2", "生命周期探针");

    // `session_configured` 是**生命周期**事件 —— 不绑定任何 submission,
    // 必须用 `EVENT_ID_NONE = ""`。
    let cfg = wait_until(
        &rx,
        |e| msg_type(e) == Some("session_configured"),
        Duration::from_secs(20),
    )
    .unwrap_or_else(|| panic!("没有 session_configured 事件"));
    assert_eq!(
        event_id(&cfg),
        "",
        "生命周期事件的 id 应为 EVENT_ID_NONE(\"\"): {cfg}"
    );

    // 生命周期事件仍然带齐自己的字段(前端要靠它们建会话上下文)。
    assert!(
        cfg["msg"]["session_id"].is_string(),
        "session_configured 缺少 session_id: {cfg}"
    );
    assert!(
        cfg["msg"]["model"].is_string(),
        "session_configured 缺少 model: {cfg}"
    );
    assert!(
        cfg["msg"]["approval_policy"].is_string(),
        "session_configured 缺少 approval_policy: {cfg}"
    );
    assert!(
        cfg["msg"]["sandbox_policy"].is_string(),
        "session_configured 缺少 sandbox_policy: {cfg}"
    );
}

#[test]
fn per_turn_events_pair_with_the_submission_id() {
    let rx = collect_events();
    let submission_id = "capability-event-sub-3";
    submit(submission_id, "配对探针");

    // `turn_started` 是 **per-turn** 事件 —— id 必须等于本次 `Submission.id`,
    // 前端正是靠这个配对把事件归到对应的 turn 上。
    let started = wait_until(
        &rx,
        |e| msg_type(e) == Some("turn_started") && event_id(e) == submission_id,
        Duration::from_secs(20),
    )
    .unwrap_or_else(|| panic!("没有与本次提交配对的 turn_started 事件"));
    assert!(
        started["msg"]["turn_id"].is_string(),
        "turn_started 缺少 turn_id: {started}"
    );
}

#[test]
fn turn_failure_is_reported_on_the_same_channel() {
    let rx = collect_events();
    let submission_id = "capability-event-sub-4";
    submit(submission_id, "失败路径探针");

    // 无可用凭证时,失败也必须走**同一条** `reflect_event` 通道回到前端 ——
    // 前端 reducer 靠 `msg.type == "error"` 显示错误条。
    let err = wait_until(
        &rx,
        |e| msg_type(e) == Some("error") && event_id(e) == submission_id,
        Duration::from_secs(20),
    )
    .unwrap_or_else(|| panic!("没有与本次提交配对的 error 事件"));
    assert!(
        err["msg"]["code"].is_string() || err["msg"]["message"].is_string(),
        "error 事件缺少 code/message: {err}"
    );
}

/// `AGENTS.md` 的宿主不变量:慢订阅者触发 `RecvError::Lagged(n)` 时
/// 转发器**只记日志、不退出**。破了这条,前端会在一次事件洪峰之后
/// 永久收不到任何事件 —— 且不报错。
///
/// 生产转发器的接收端跟不跟得上无法从外部确定性地制造,所以这里用一条
/// 容量只有 4 的通道单独驱动一个 `forward_agent_events`,并用
/// **单线程** runtime 保证它在 64 条突发**之后**才第一次被调度:它的第一个
/// `recv()` 必然拿到 `Lagged`。之后再发一条探针 —— 探针能到达
/// `reflect_event`,就证明转发器没死。
#[test]
fn forwarder_survives_a_lagged_receiver() {
    use reflect_protocol::{Event, EventMsg};
    use tokio::sync::broadcast;

    let rx_events = collect_events();
    let app_handle = {
        let h = common::harness();
        h.app.handle().clone()
    };

    let (tx, rx) = broadcast::channel::<Event>(4);
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("build single-thread runtime");
    let forwarder = rt.spawn(reflect_desktop_lib::events::forward_agent_events(
        app_handle, rx,
    ));

    // 突发 64 条 —— 远超容量 4。转发器此刻还没跑过一次。
    for i in 0..64 {
        tx.send(Event::new(
            format!("lag-burst-{i}"),
            EventMsg::SubmissionClosed,
        ))
        .expect("broadcast send");
    }
    rt.block_on(async {
        for _ in 0..16 {
            tokio::task::yield_now().await;
        }
    });

    // lag 之后再发探针。
    tx.send(Event::new("lag-probe", EventMsg::SubmissionClosed))
        .expect("broadcast send probe");
    rt.block_on(async {
        for _ in 0..16 {
            tokio::task::yield_now().await;
        }
    });

    // 其它用例的真实 agent 事件也会进这条队列 —— 只认 `lag-` 前缀的。
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    let mut burst_received = 0usize;
    let mut probe: Option<Value> = None;
    while probe.is_none() {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        match rx_events.recv_timeout(remaining.min(Duration::from_millis(200))) {
            Ok(v) => {
                let id = event_id(&v);
                if id.starts_with("lag-burst-") {
                    burst_received += 1;
                } else if id == "lag-probe" {
                    probe = Some(v);
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    let probe = probe.expect("转发器在 Lagged 之后死了 —— 探针事件没有到达 reflect_event");
    assert_eq!(msg_type(&probe), Some("submission_closed"));
    assert!(
        burst_received <= 4,
        "突发 64 条却收到 {burst_received} 条 —— 通道没有发生 lag,本用例没有覆盖到 Lagged 分支"
    );
    assert!(
        burst_received >= 1,
        "lag 之后缓冲区里残留的事件也应被继续转发,实际一条都没到"
    );
    assert!(!forwarder.is_finished(), "转发器任务在 Lagged 之后退出了");

    // 通道关闭(`Closed`)才是转发器唯一合法的退出路径。
    drop(tx);
    rt.block_on(async {
        tokio::time::timeout(Duration::from_secs(2), forwarder)
            .await
            .expect("转发器在通道关闭后 2s 内没有退出")
            .expect("转发器任务 panic");
    });
}
