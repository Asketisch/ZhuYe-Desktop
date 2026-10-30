//! 只读权限文件不能被永久授权操作覆盖。
#![cfg(unix)]
mod common;

#[test]
fn adding_a_rule_rejects_read_only_permission_file() {
    use std::os::unix::fs::PermissionsExt;
    common::invoke_ok(
        "reflect_add_permission_rule",
        serde_json::json!({
            "rule": {"tool": "initial-probe", "action": "deny"}
        }),
    );
    let path =
        std::path::PathBuf::from(std::env::var_os("HOME").unwrap()).join(".zhuye/permissions.toml");
    let original = std::fs::read(&path).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o444)).unwrap();
    common::invoke_err(
        "reflect_add_permission_rule",
        serde_json::json!({
            "rule": {"tool": "later-probe", "action": "allow"}
        }),
    );
    assert_eq!(std::fs::read(&path).unwrap(), original);
}
