//! 无 provider 时显式区分空跑与真实讨论。
mod common;

use serde_json::json;

#[test]
fn discussion_without_provider_reports_no_model_backing() {
    common::init_isolated_env();
    std::fs::write(
        "discussion-no-model.toml",
        r#"[discussion]
mode = "sequential"
topic = "fallback"
max_rounds = 1
[[agents]]
role = "advocate"
system_prompt = "speak"
[[agents]]
role = "skeptic"
system_prompt = "respond"
"#,
    )
    .unwrap();
    let outcome = common::invoke_ok(
        "reflect_run_discussion",
        json!({ "configPath": "discussion-no-model.toml" }),
    );
    assert_eq!(outcome["llmBacked"], false, "{outcome}");
    assert_eq!(outcome["transcript"], "", "{outcome}");
}
