//! 损坏的工作区历史必须报告错误并在切换项目时保留原文件。
mod common;

use serde_json::json;

#[test]
fn corrupt_history_is_not_replaced_during_workspace_switch() {
    common::invoke_ok("reflect_list_workspaces", json!({}));
    let path =
        std::path::PathBuf::from(std::env::var_os("HOME").unwrap()).join(".zhuye/workspaces.json");
    std::fs::write(&path, "broken history").unwrap();
    let error = common::invoke_err("reflect_list_workspaces", json!({}));
    assert!(error.to_string().contains("workspaces.json"));
    let workspace = common::temp_workspace("corrupt-history");
    common::set_workspace(&workspace);
    assert_eq!(common::current_workspace(), workspace);
    assert_eq!(std::fs::read_to_string(path).unwrap(), "broken history");
}
