//! 损坏的权限文件不能在界面中被误报为空规则。
mod common;

#[test]
fn unreadable_permission_rules_report_the_affected_scope() {
    common::invoke_ok("reflect_list_permission_rules", serde_json::json!({}));
    let project = std::env::current_dir()
        .unwrap()
        .join(".zhuye/permissions.toml");
    let user =
        std::path::PathBuf::from(std::env::var_os("HOME").unwrap()).join(".zhuye/permissions.toml");
    for (path, scope) in [(&project, "project"), (&user, "user")] {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "[rules\n").unwrap();
        let error = common::invoke_err("reflect_list_permission_rules", serde_json::json!({}));
        assert!(
            error.to_string().contains(scope),
            "错误应标明作用域: {error}"
        );
        std::fs::remove_file(path).unwrap();
    }
    common::invoke_ok("reflect_list_permission_rules", serde_json::json!({}));
}
