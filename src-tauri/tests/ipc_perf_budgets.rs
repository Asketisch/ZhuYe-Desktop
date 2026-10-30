//! 能力覆盖层 · 性能预算(冒烟级)—— 大数据量下的关键命令墙钟上限。
//!
//! 与 `tests/perf.budgets.test.tsx` 同理:不是基准测试,阈值取得很宽,
//! 只在出现**数量级级**回归(如会话索引被改成全量重扫、replay 逐行
//! 反序列化被放大成平方复杂度)时变红。`PERF_STRICT=1` 收紧(本地性能
//! 迭代用)。
//!
//! 预算对象:
//! - `reflect_list_sessions`:500 条真实 rollout 文件的会话索引
//!   (侧栏首屏的代理指标);
//! - `reflect_replay_session`:5 千行记录的长会话回放水合
//!   (打开历史会话的代理指标)。

mod common;

use std::time::{Duration, Instant};

use serde_json::json;

fn strict() -> bool {
    std::env::var("PERF_STRICT").as_deref() == Ok("1")
}

/// rollout 根目录(`<HOME>/.zhuye/sessions`),夹具初始化后可用。
fn sessions_root() -> std::path::PathBuf {
    let home = std::env::var("HOME").expect("HOME 未隔离");
    std::path::Path::new(&home).join(".zhuye/sessions")
}

/// 造一条真会话记录:首行 session_meta(索引靠它建条目),后跟 `lines` 条
/// message 记录。日期分目录按真实布局(YYYY/MM/DD)。
fn seed_rollout_with_lines(id: &str, lines: usize, age_days: u64) {
    let now = chrono::Utc::now() - chrono::Duration::days(age_days as i64);
    let dir = sessions_root()
        .join(now.format("%Y").to_string())
        .join(now.format("%m").to_string())
        .join(now.format("%d").to_string());
    std::fs::create_dir_all(&dir).expect("create rollout dir");
    let meta = json!({
        "type": "session_meta",
        "session_id": id,
        "model": "perf/model",
        "started_at": now.to_rfc3339(),
    });
    let mut body = format!("{meta}\n");
    for i in 0..lines {
        // Message 记录的 turn_id 是 TurnId(Uuid) —— 非 UUID 会被整行丢弃。
        // 一轮 = user + assistant 共用同一 turn_id,与真实文件一致。
        let record = json!({
            "type": "message",
            "turn_id": format!("00000000-0000-4000-8000-{:012x}", i / 2),
            "role": if i % 2 == 0 { "user" } else { "assistant" },
            "content": format!("性能预算探针记录 {id} #{i}:一段固定长度的测量文本。"),
        });
        body.push_str(&format!("{record}\n"));
    }
    std::fs::write(dir.join(format!("{id}.jsonl")), body).expect("write rollout file");
}

fn uuid_v4(i: u32) -> String {
    // 确定性伪 UUID(合法形态即可,索引不校验版本位)。
    format!("00000000-0000-4000-8000-{i:012x}")
}

fn assert_within(name: &str, elapsed: Duration, loose: Duration, strict_budget: Duration) {
    let budget = if strict() { strict_budget } else { loose };
    assert!(
        elapsed < budget,
        "{name} 用了 {elapsed:?}(预算 {budget:?},PERF_STRICT={}):数量级级回归",
        if strict() { "1" } else { "0" }
    );
}

#[test]
fn listing_500_sessions_stays_within_budget() {
    drop(common::harness());
    for i in 0..500 {
        seed_rollout_with_lines(&uuid_v4(i), 1, i as u64 % 30);
    }
    let t0 = Instant::now();
    let v = common::invoke_ok("reflect_list_sessions", json!({}));
    let elapsed = t0.elapsed();
    let count = v.as_array().map(|a| a.len()).unwrap_or(0);
    assert!(count >= 500, "应索引到 500 条会话,实际 {count}");
    assert_within(
        "list_sessions(500 条 rollout)",
        elapsed,
        Duration::from_secs(10),
        Duration::from_secs(3),
    );
}

#[test]
fn replaying_a_5k_record_session_stays_within_budget() {
    drop(common::harness());
    let id = uuid_v4(0xF00);
    seed_rollout_with_lines(&id, 5_000, 1);
    let t0 = Instant::now();
    let v = common::invoke_ok("reflect_replay_session", json!({ "id": id }));
    let elapsed = t0.elapsed();
    let records = v.as_array().map(|a| a.len()).unwrap_or(0);
    assert!(records >= 5_000, "回放应含 5000 条记录,实际 {records}");
    assert_within(
        "replay_session(5k 行)",
        elapsed,
        Duration::from_secs(15),
        Duration::from_secs(5),
    );
}
