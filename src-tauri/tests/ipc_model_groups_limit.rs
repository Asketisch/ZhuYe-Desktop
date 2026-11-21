//! 能力覆盖 · 模型组数量上限 —— 「模型组可以无限添加」的回归钉。
//!
//! 用户反馈「模型组只支持两个」：本测试走**真实命令体**（不经前端）
//! 验证 `zhuye_save_config` 对 N 个 `[[model_group]]` 的保存 / 读回 /
//! 再编辑全部无数量限制 —— 若上游校验或 v1→v2 迁移丢组，这里必红。

mod common;

use serde_json::json;

/// 构造 N 个组的 TOML（模拟用户连加 N 次后的最终形态：组带 endpoint /
/// model / base_url，最后一组带组内凭据）。
fn groups_toml(n: usize) -> String {
    let mut out = String::from("[active]\ngroup = \"g1\"\n\n");
    for i in 1..=n {
        out.push_str(&format!(
            "[[model_group]]\nid = \"g{i}\"\nendpoint = \"openai\"\nbase_url = \"https://g{i}.test\"\nmodel = \"m{i}\"\n\n"
        ));
    }
    out.push_str("[[model_group.credentials]]\ngroup = \"g1\"\nlabel = \"extra\"\napi_key = \"sk-x\"\n\n");
    // credentials 是 model_group 数组的延续 —— 归属最后一组；此处简化：
    // 直接放组后（TOML 数组延续），上面 group 字段仅为可读性。
    out
}

#[test]
fn model_groups_support_unlimited_entries() {
    let _guard = common::state_lock();
    for n in [1usize, 2, 3, 5, 10] {
        let toml = groups_toml(n);
        common::invoke_ok("zhuye_save_config", json!({ "toml": toml }));
        let read = common::invoke_ok("zhuye_get_config", json!({}));
        let text = read.as_str().expect("config 必须是字符串");
        let count = text.matches("[[model_group]]").count();
        assert_eq!(count, n, "{n} 个组保存后读回应有 {n} 个组头，实际 {count}:\n{text}");
        for i in 1..=n {
            assert!(text.contains(&format!("id = \"g{i}\"")), "组 g{i} 丢失:\n{text}");
        }
    }
}

#[test]
fn model_groups_survive_migration_roundtrip() {
    let _guard = common::state_lock();
    // 旧版固定段（[openai]）+ 两个模型组共存：迁移 + 保存后组不丢。
    let toml = "[active]\ngroup = \"kept\"\n\n[openai]\nmodel = \"legacy\"\n\n[[model_group]]\nid = \"kept\"\nendpoint = \"openai\"\nmodel = \"m1\"\n\n[[model_group]]\nid = \"kept2\"\nendpoint = \"anthropic\"\nmodel = \"m2\"\n";
    common::invoke_ok("zhuye_save_config", json!({ "toml": toml }));
    let read = common::invoke_ok("zhuye_get_config", json!({}));
    let text = read.as_str().unwrap();
    let count = text.matches("[[model_group]]").count();
    assert!(count >= 2, "迁移后两个组都应保留，实际 {count}:\n{text}");
    assert!(text.contains("kept2"), "第二组丢失:\n{text}");
}
