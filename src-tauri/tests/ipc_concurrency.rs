//! 能力覆盖层 · 并发/竞态 —— 并行 IPC 压力下的不变量。
//!
//! 真实桌面的命令都从同一个 UI 线程发起;但 Tauri 命令是 async 的,
//! 慢命令(网络 / git / 大文件)与后续命令**天然并发**。此前门禁里所有
//! 能力覆盖用例都是单线程顺序调用(`common::invoke` 的 harness 锁只覆盖
//! 派发、不覆盖执行,所以这里的并行是**真并发**)。
//!
//! ## 断言口径
//!
//! 盯**不变量**而不是原子性:
//!
//! - 并行只读命令全部成功、不 panic;
//! - 并行 submit + 交错 interrupt:全部被受理,事后 agent 仍响应;
//! - 并行配置写(读快照 → 改一项 → 写回):配置文件**始终是合法 TOML**、
//!   不死锁、不 panic。**不断言** 8 条全部落盘 —— 「并发丢更新」是
//!   `tests/COVERAGE.md` §4 记录在案的已知特征(真实 UI 不会并发发这类
//!   命令),这里盯的是更糟的失败模式:写坏文件或卡死。

mod common;

use std::sync::Arc;

use serde_json::json;

/// 并行只读命令:32 线程 × 20 次,混合三种高频读命令。
#[test]
fn parallel_reads_never_panic_or_error() {
    drop(common::harness()); // 触发隔离环境初始化
    const THREADS: usize = 32;
    const PER_THREAD: usize = 20;
    let cmds: &[&str] = &[
        "reflect_agent_status",
        "reflect_list_sessions",
        "reflect_get_config",
    ];
    let failures = Arc::new(std::sync::Mutex::new(Vec::new()));
    let barrier = Arc::new(std::sync::Barrier::new(THREADS));
    let mut handles = Vec::new();
    for t in 0..THREADS {
        let failures = failures.clone();
        let barrier = barrier.clone();
        handles.push(std::thread::spawn(move || {
            barrier.wait(); // 尽量同时起跑
            for i in 0..PER_THREAD {
                let cmd = cmds[(t + i) % cmds.len()];
                if let Err(e) = common::invoke(cmd, json!({})) {
                    failures.lock().unwrap().push(format!("{cmd}: {e}"));
                }
            }
        }));
    }
    for h in handles {
        h.join().expect("读线程 panic");
    }
    let failures = failures.lock().unwrap();
    assert!(
        failures.is_empty(),
        "并行只读命令出现 {} 次失败(前 5 条):{}",
        failures.len(),
        failures
            .iter()
            .take(5)
            .cloned()
            .collect::<Vec<_>>()
            .join("; ")
    );
}

/// 并行 submit 风暴 + 交错 interrupt:全部受理、无 panic、事后 agent 仍响应。
#[test]
fn submit_storm_with_interleaved_interrupts_keeps_the_agent_responsive() {
    drop(common::harness());
    const SUBMITS: usize = 16;
    let failures = Arc::new(std::sync::Mutex::new(Vec::new()));
    let mut handles = Vec::new();
    for i in 0..SUBMITS {
        let failures = failures.clone();
        handles.push(std::thread::spawn(move || {
            let v = common::invoke(
                "reflect_submit",
                json!({
                    "submission": {
                        "id": format!("concurrency-storm-{i}"),
                        "op": { "type": "user_input", "items": [{ "type": "text", "text": format!("并发风暴 {i}") }] },
                    }
                }),
            );
            match v {
                Ok(id) => assert!(id.is_string(), "submit 应返回 id: {id}"),
                Err(e) => failures.lock().unwrap().push(format!("submit#{i}: {e}")),
            }
        }));
    }
    // 交错发几次 interrupt(可能打断、可能落空,都不能崩)。
    for _ in 0..4 {
        let _ = common::invoke("reflect_interrupt", json!({}));
    }
    for h in handles {
        h.join().expect("submit 线程 panic");
    }
    let failures = failures.lock().unwrap();
    assert!(
        failures.is_empty(),
        "submit 风暴出现失败: {:?}",
        failures.iter().take(5).collect::<Vec<_>>()
    );
    // 事后 agent 仍响应。
    let status = common::invoke_ok("reflect_agent_status", json!({}));
    assert!(status.is_object(), "风暴后 agent_status 异常: {status}");
}

/// 并行配置写:**不持** `state_lock` 连发 8 条 `upsert_mcp_server` ——
/// 配置文件必须始终是合法 TOML,进程不死锁、不 panic。丢更新(≤8 条)
/// 是已知特征,不在断言范围(见本文件头注释)。
#[test]
fn concurrent_config_writes_keep_the_file_valid() {
    drop(common::harness());
    const WRITERS: usize = 8;
    let barrier = Arc::new(std::sync::Barrier::new(WRITERS));
    let mut handles = Vec::new();
    for i in 0..WRITERS {
        let barrier = barrier.clone();
        handles.push(std::thread::spawn(move || {
            barrier.wait();
            common::invoke_ok(
                "reflect_upsert_mcp_server",
                json!({
                    "name": format!("concurrency-mcp-{i}"),
                    "entry": { "type": "stdio", "command": "echo", "args": ["probe"] }
                }),
            );
        }));
    }
    for h in handles {
        h.join().expect("配置写线程 panic"); // invoke 内部 30s 超时兜底死锁
    }

    // 配置文件仍是合法 TOML。
    let data_dir = reflect_config::paths::data_dir().expect("夹具应已设置 HOME");
    let raw = std::fs::read_to_string(data_dir.join("config.toml")).expect("读回 config.toml");
    let parsed: toml::Value = toml::from_str(&raw).unwrap_or_else(|e| {
        panic!("并发写之后 config.toml 不再是合法 TOML:\n{raw}\n解析错误: {e}")
    });

    // 落盘条数 1..=8:8 条全在最好;少于 8 是已知丢更新,0 条则说明全丢。
    let entries = parsed
        .get("mcp_servers")
        .and_then(|m| m.as_table())
        .map_or(0, |t| t.len());
    assert!(
        (1..=WRITERS).contains(&entries),
        "并发写后 mcp_servers 条数 {entries} 不在 1..={WRITERS} —— 全部丢失或计数异常"
    );

    // 写完之后配置命令仍可用(读写器没有死锁或损坏状态)。
    let list = common::invoke_ok("reflect_list_mcp_servers", json!({}));
    assert!(list.is_array(), "并发写后 list_mcp_servers 异常: {list}");
}
