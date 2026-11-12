#![cfg(unix)]
mod common;
use serde_json::json;

#[test]
fn pipeline_passes_custom_input_to_shell_template() {
    let source = r#"name = "input-probe"
[nodes.first]
runner = "shell"
[nodes.first.params]
command = "printf '{{input.value}}' > input-result.txt"
"#;
    let saved = common::invoke_ok(
        "reflect_save_pipeline_config",
        json!({ "name": "input-probe", "tomlSrc": source }),
    );
    let report = common::invoke_ok(
        "reflect_run_pipeline",
        json!({
            "configPath": saved["path"], "topic": "input probe", "inputs": {"value": "fixture-value"}
        }),
    );
    assert_eq!(report["status"], "success", "{report}");
    assert_eq!(
        std::fs::read_to_string("input-result.txt").unwrap(),
        "fixture-value"
    );
}
