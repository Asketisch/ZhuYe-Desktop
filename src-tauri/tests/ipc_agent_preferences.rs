//! 活跃 Agent 更新不能丢失无法解析或其他桌面偏好。
mod common;

use serde_json::json;

#[test]
fn active_agent_update_preserves_other_preferences_and_rejects_corruption() {
    let before = common::invoke_ok("reflect_get_active_agent", json!({}));
    let path =
        std::path::PathBuf::from(std::env::var_os("HOME").unwrap()).join(".zhuye/desktop.json");
    std::fs::write(&path, "broken").unwrap();
    let error = common::invoke_err("reflect_set_active_agent", json!({"name": "next"}));
    assert!(error.to_string().contains("desktop preferences"));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "broken");
    let after = common::invoke_ok("reflect_get_active_agent", json!({}));
    assert_eq!(before["name"], after["name"]);

    std::fs::write(
        &path,
        r#"{"active_agent":"default","other_setting":{"enabled":true}}"#,
    )
    .unwrap();
    common::invoke_ok("reflect_set_active_agent", json!({"name": "next"}));
    let prefs: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(prefs["active_agent"], "next");
    assert_eq!(prefs["other_setting"]["enabled"], true);
}
