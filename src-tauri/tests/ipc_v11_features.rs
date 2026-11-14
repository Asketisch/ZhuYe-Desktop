//! 能力覆盖层 · v1.11 功能域 —— 真实命令体 over 真实 IPC 通路。
//!
//! 覆盖(与 feature-gap-report 对齐):
//! - 桌面#2 插件市场:`reflect_browse_marketplace` /
//!   `reflect_install_from_marketplace`(未注册市场 fail-fast)
//! - 桌面#1 Skill 市场:`reflect_install_skill`(repo 形态校验先于网络)
//! - 桌面#5 多目录工作区:`reflect_set_workspace_dirs` /
//!   `reflect_current_workspace_dirs`(校验 / 去重 / 状态回读)
//! - 基建#12 远程状态页:`reflect_status_server_start` /
//!   `reflect_status_server_state` / `reflect_status_server_stop`
//!   (启动 → 端口可见 → 停止 → 归零;HTTP 行为由 status_server 单测覆盖)

mod common;

use serde_json::json;

// ============================================================================
// 桌面#2:插件市场
// ============================================================================

#[test]
fn browse_unregistered_marketplace_fails_with_hint() {
    let _guard = common::state_lock();
    let err = common::invoke_err(
        "reflect_browse_marketplace",
        json!({ "name": "no-such-mkt-v11" }),
    );
    let msg = err["msg"].as_str().expect("错误应带 msg");
    assert!(
        msg.contains("not registered"),
        "未注册市场应报 not registered: {msg}"
    );
}

#[test]
fn install_from_unregistered_marketplace_fails_fast() {
    let _guard = common::state_lock();
    let err = common::invoke_err(
        "reflect_install_from_marketplace",
        json!({ "marketplace": "no-such-mkt-v11", "plugin": "demo" }),
    );
    let msg = err["msg"].as_str().expect("错误应带 msg");
    assert!(
        msg.contains("not registered"),
        "未注册市场安装应 fail-fast: {msg}"
    );
}

#[test]
fn browse_rejects_invalid_marketplace_name() {
    let _guard = common::state_lock();
    // 市场名校验(MarketplaceName::parse):大写 / 空格非法。
    let err = common::invoke_err("reflect_browse_marketplace", json!({ "name": "BAD NAME" }));
    let msg = err["msg"].as_str().expect("错误应带 msg");
    assert!(
        msg.contains("invalid marketplace name"),
        "非法市场名应被拒绝: {msg}"
    );
}

// ============================================================================
// 桌面#1:Skill 市场
// ============================================================================

#[test]
fn install_skill_rejects_invalid_repo_before_network() {
    let _guard = common::state_lock();
    // `owner/repo` 形态校验在命令体第一步,非法形态直接报错,不发网络请求。
    for bad in ["just-a-name", "https://example.com/a/b", ""] {
        let err = common::invoke_err("reflect_install_skill", json!({ "repo": bad }));
        let msg = err["msg"].as_str().expect("错误应带 msg");
        assert!(!msg.is_empty(), "非法 repo `{bad}` 应被拒绝且带原因");
    }
}

// ============================================================================
// 桌面#5:多目录综合工作区
// ============================================================================

#[test]
fn workspace_dirs_roundtrip_with_validation_and_dedup() {
    let _guard = common::state_lock();

    // 主工作区不存在 → 显性拒绝。
    let err = common::invoke_err(
        "reflect_set_workspace_dirs",
        json!({ "main": "/nonexistent/ws-v11", "additional": [] }),
    );
    let msg = err["msg"].as_str().expect("错误应带 msg");
    assert!(
        msg.contains("does not exist"),
        "不存在的主工作区应报错: {msg}"
    );

    // 附加目录不存在 → 显性拒绝。
    let main = std::env::temp_dir().join(format!("ws-v11-main-{}", std::process::id()));
    std::fs::create_dir_all(&main).expect("创建主工作区");
    let err = common::invoke_err(
        "reflect_set_workspace_dirs",
        json!({ "main": main.display().to_string(), "additional": ["/nonexistent/extra-v11"] }),
    );
    let msg = err["msg"].as_str().expect("错误应带 msg");
    assert!(
        msg.contains("does not exist"),
        "不存在的附加目录应报错: {msg}"
    );

    // 合法设置:附加目录去重 + 与主目录相同的项跳过。
    let extra_a = std::env::temp_dir().join(format!("ws-v11-extra-a-{}", std::process::id()));
    let extra_b = std::env::temp_dir().join(format!("ws-v11-extra-b-{}", std::process::id()));
    std::fs::create_dir_all(&extra_a).expect("创建附加目录 a");
    std::fs::create_dir_all(&extra_b).expect("创建附加目录 b");
    let main_str = main.display().to_string();
    let a_str = extra_a.display().to_string();
    common::invoke_ok(
        "reflect_set_workspace_dirs",
        json!({ "main": main_str, "additional": [a_str, a_str.clone(), main_str] }),
    );
    let got = common::invoke_ok("reflect_current_workspace_dirs", json!({}));
    assert_eq!(
        got["additional"].as_array().expect("additional 数组").len(),
        1,
        "重复与主目录同路径的附加项应被去重: {got}"
    );
    assert_eq!(
        got["additional"][0].as_str(),
        Some(a_str.as_str()),
        "附加目录应保留首个: {got}"
    );

    // 收尾:清空附加目录(测试间不串)。
    common::invoke_ok(
        "reflect_set_workspace_dirs",
        json!({ "main": main_str, "additional": [] }),
    );
    let got = common::invoke_ok("reflect_current_workspace_dirs", json!({}));
    assert!(
        got["additional"]
            .as_array()
            .expect("additional 数组")
            .is_empty(),
        "清空后应为空: {got}"
    );
}

// ============================================================================
// 基建#12:远程网页访问状态服务器
// ============================================================================

#[test]
fn status_server_start_state_stop_roundtrip() {
    let _guard = common::state_lock();

    // 初始未运行。
    let state = common::invoke_ok("reflect_status_server_state", json!({}));
    assert!(
        state.as_null().is_some() || state.is_null(),
        "初始状态应为 null(未运行): {state}"
    );

    // 启动(port=0 自动分配)→ 端口可见。
    let started = common::invoke_ok("reflect_status_server_start", json!({ "port": 0 }));
    let port = started.as_u64().expect("启动应返回绑定端口");
    assert!(port > 0, "自动分配端口应 > 0: {port}");

    let state = common::invoke_ok("reflect_status_server_state", json!({}));
    assert_eq!(
        state.as_u64(),
        Some(port),
        "运行中状态应报告同一端口: {state}"
    );

    // 停止 → 状态归零;重复停止幂等。
    common::invoke_ok("reflect_status_server_stop", json!({}));
    common::invoke_ok("reflect_status_server_stop", json!({}));
    let state = common::invoke_ok("reflect_status_server_state", json!({}));
    assert!(
        state.as_null().is_some() || state.is_null(),
        "停止后状态应回到 null: {state}"
    );
}

// ============================================================================
// 桌面#9:外部 Agent 会话导入
// ============================================================================

#[test]
fn import_discover_rejects_unknown_kind() {
    let _guard = common::state_lock();
    let err = common::invoke_err(
        "reflect_import_discover",
        json!({ "kind": "not-a-harness" }),
    );
    let msg = err["msg"].as_str().expect("错误应带 msg");
    assert!(
        msg.contains("unknown harness kind"),
        "非法 kind 应显式拒绝: {msg}"
    );
}

#[test]
fn import_sessions_unknown_kind_fails_fast() {
    let _guard = common::state_lock();
    let err = common::invoke_err(
        "reflect_import_sessions",
        json!({ "kind": "bogus", "dryRun": true }),
    );
    let msg = err["msg"].as_str().expect("错误应带 msg");
    assert!(
        msg.contains("unknown harness kind"),
        "导入对非法 kind 应 fail-fast: {msg}"
    );
}

#[test]
fn import_discover_zcode_returns_list_or_clean_error() {
    let _guard = common::state_lock();
    // ZCode 来源依赖 `~/.zcode/cli/db/db.sqlite` 存在与否(沙箱 HOME 里
    // 通常没有)→ 空清单或明确的发现错误都算合法;绝不允许 panic。
    let result = common::invoke("reflect_import_discover", json!({ "kind": "zcode" }));
    match result {
        Ok(list) => {
            assert!(list.is_array(), "发现结果应为数组: {list}");
        }
        Err(err) => {
            let msg = err["msg"].as_str().unwrap_or_default();
            assert!(!msg.is_empty(), "错误必须带原因: {err}");
        }
    }
}
