//! 损坏的 Autopilot 数据通过真实 IPC 报错，而非伪装成默认值。
mod common;

use serde_json::json;

#[test]
fn corrupt_config_and_history_are_reported() {
    common::invoke_ok("reflect_get_autopilot_config", json!({}));
    let root = common::isolated_home().join(".zhuye/autopilot");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("config.json"), "invalid config").unwrap();
    std::fs::write(root.join("history.json"), "invalid history").unwrap();
    let config_error = common::invoke_err("reflect_get_autopilot_config", json!({}));
    let history_error = common::invoke_err("reflect_autopilot_history", json!({}));
    assert!(
        config_error.to_string().contains("config.json"),
        "{config_error}"
    );
    assert!(
        history_error.to_string().contains("history.json"),
        "{history_error}"
    );
}
