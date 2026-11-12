//! 通过真实 IPC 验证 shell DAG 的校验、执行和依赖失败传播。
#![cfg(unix)]
mod common;

use serde_json::json;

#[test]
fn shell_pipeline_runs_without_teams_and_skips_failed_dependencies() {
    let source = r#"
name = "shell-runtime"
[nodes.first]
runner = "shell"
[nodes.first.params]
command = "printf first > pipeline-first.txt"
[nodes.second]
runner = "shell"
depends_on = ["first"]
[nodes.second.params]
command = "cat pipeline-first.txt; printf second > pipeline-second.txt"
"#;
    let validated = common::invoke_ok("reflect_validate_pipeline", json!({ "tomlSrc": source }));
    assert_eq!(validated["valid"], true, "{validated}");
    assert_eq!(validated["missingTeams"], json!([]));
    let saved = common::invoke_ok(
        "reflect_save_pipeline_config",
        json!({ "name": "shell-runtime", "tomlSrc": source }),
    );
    let report = common::invoke_ok(
        "reflect_run_pipeline",
        json!({
            "configPath": saved["path"], "topic": "runtime check"
        }),
    );
    assert_eq!(report["status"], "success", "{report}");
    assert_eq!(
        std::fs::read_to_string("pipeline-second.txt").unwrap(),
        "second"
    );
    assert!(report["nodes"].as_array().unwrap().iter().any(|node| {
        node["name"] == "second"
            && node["outputs"]["stdout"]
                .as_str()
                .unwrap_or_default()
                .contains("first")
    }));

    let failed = source.replace("printf first > pipeline-first.txt", "exit 7");
    std::fs::remove_file("pipeline-second.txt").unwrap();
    let saved = common::invoke_ok(
        "reflect_save_pipeline_config",
        json!({ "name": "shell-failure", "tomlSrc": failed }),
    );
    let report = common::invoke_ok(
        "reflect_run_pipeline",
        json!({
            "configPath": saved["path"], "topic": "failure check"
        }),
    );
    assert_eq!(report["status"], "failed", "{report}");
    assert!(
        report["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|node| node["name"] == "second" && node["status"] == "skipped")
    );
    assert!(!std::path::Path::new("pipeline-second.txt").exists());
}
