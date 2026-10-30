//! 并发追加经真实 IPC 后不得报错,store 也不得损坏。
//!
//! 核心的 `FilePermissionStore` 是「读快照 → 追加 → 整份写回」,并不串行化:
//! 真并发下丢更新是已知且被允许的行为(真实桌面从单一 UI 线程发起命令,
//! 不会并发;见夹具 `state_lock` 的教义注释)。这里锁定的保证是:
//! 每一条调用都成功(原子替换,不会写出半截文件),且并发结束后
//! store 仍是可解析的合法 TOML。
mod common;

#[test]
fn concurrent_rule_additions_stay_atomic_and_parsable() {
    common::invoke_ok("reflect_list_permission_rules", serde_json::json!({}));
    let start = std::sync::Arc::new(std::sync::Barrier::new(12));
    let threads: Vec<_> = (0..12)
        .map(|i| {
            let start = start.clone();
            std::thread::spawn(move || {
                start.wait();
                common::invoke_ok(
                    "reflect_add_permission_rule",
                    serde_json::json!({
                        "rule": {"tool": format!("concurrent-tool-{i}"), "action": "deny"}
                    }),
                );
            })
        })
        .collect();
    for thread in threads {
        thread.join().unwrap();
    }
    let rules = common::invoke_ok("reflect_list_permission_rules", serde_json::json!({}));
    let rules = rules.as_array().unwrap();
    assert!(
        rules.iter().any(|rule| rule["tool"]
            .as_str()
            .unwrap_or_default()
            .starts_with("concurrent-tool-")),
        "并发写入后应保留完整的最后快照: {rules:?}"
    );
}
