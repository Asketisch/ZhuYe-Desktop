//! 能力覆盖层 · v1.11 功能域 —— 真实命令体 over 真实 IPC 通路。
//!
//! 覆盖(与 feature-gap-report 对齐):
//! - 桌面#2 插件市场:`reflect_browse_marketplace` /
//!   `reflect_install_from_marketplace`(未注册市场 fail-fast + 本地
//!   directory 市场成功路径:浏览字段级 / 一键安装落盘记账与缓存物化)
//! - 桌面#1 Skill 市场:`reflect_install_skill`(repo 形态校验先于网络;
//!   成功路径走 GitHub 网络,按 COVERAGE §3 网络类口径豁免,前端
//!   安装后自动重扫由 SkillsView 行为测试断言)
//! - 桌面#5 多目录工作区:`reflect_set_workspace_dirs` /
//!   `reflect_current_workspace_dirs`(校验 / 去重 / 状态回读);
//!   附加目录 → sandbox_writable 的并入语义由 thread_factory 单测覆盖
//! - 基建#12 远程状态页:`reflect_status_server_start` /
//!   `reflect_status_server_state` / `reflect_status_server_stop`
//!   (启动 → 端口可见 → 停止 → 归零);token 经
//!   `reflect_update_remote_config` → start 的 IPC 组合路径含真 HTTP
//!   401/401/200 三态
//! - 基建#7 SSH 远端:参数拼装语义由 `commands/shell.rs` 单测覆盖
//!   (`ssh_argv`:BatchMode / ConnectTimeout / host trim / 命令单参数)

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

// ============================================================================
// 桌面#2 补:插件市场**成功路径**(本地 directory 市场,零网络)
// ============================================================================

/// 在隔离 HOME 里物化一个本地 marketplace fixture(与上游
/// zhuye-plugin manager 测试同款布局):
/// - `<home>/mkt-v11/.claude-plugin/marketplace.json`(含一个 demo 插件)
/// - `<home>/mkt-v11/plugins/demo/plugin.toml`
/// - `<home>/.zhuye/plugins/marketplaces.json`(注册该市场,Directory 源)
fn write_local_marketplace_fixture() -> String {
    let home = common::isolated_home();
    let mkt_root = home.join("mkt-v11");
    std::fs::create_dir_all(mkt_root.join(".claude-plugin")).expect("建 .claude-plugin 目录");
    let plugin_dir = mkt_root.join("plugins").join("demo");
    std::fs::create_dir_all(&plugin_dir).expect("建插件目录");
    std::fs::write(
        plugin_dir.join("plugin.toml"),
        "name = \"demo\"\nversion = \"2.0.0\"\ndescription = \"from marketplace\"\n",
    )
    .expect("写 plugin.toml");
    // 纯静态 JSON(与上游 manager 测试 fixture 同构),无需插值。
    let manifest = r#"{
        "name": "v11-local",
        "owner": { "name": "ipc" },
        "plugins": [
            {
                "name": "demo",
                "version": "2.0.0",
                "description": "from marketplace",
                "source": { "source": "directory", "path": "./plugins/demo" }
            }
        ]
    }"#;
    std::fs::write(
        mkt_root.join(".claude-plugin").join("marketplace.json"),
        manifest,
    )
    .expect("写 marketplace.json");
    // 注册到 known marketplaces(与 CLI `marketplace add --from directory`
    // 落盘同构;Directory 源零网络,测试确定性)。
    let known = json!({
        "marketplaces": {
            "v11-local": {
                "source": { "source": "directory", "path": mkt_root.display().to_string() },
                "install_location": mkt_root.display().to_string(),
                "last_updated": "2026-11-15T00:00:00Z",
                "auto_update": false
            }
        }
    });
    let plugins_root = home.join(".zhuye").join("plugins");
    std::fs::create_dir_all(&plugins_root).expect("建 plugins 根");
    std::fs::write(
        plugins_root.join("marketplaces.json"),
        serde_json::to_string_pretty(&known).expect("序列化注册表"),
    )
    .expect("写 marketplaces.json");
    "v11-local".to_string()
}

#[test]
fn browse_local_marketplace_lists_plugin_fields() {
    let _guard = common::state_lock();
    let mkt = write_local_marketplace_fixture();
    let list = common::invoke_ok("reflect_browse_marketplace", json!({ "name": mkt }));
    let arr = list.as_array().expect("浏览结果应为数组");
    assert_eq!(arr.len(), 1, "fixture 恰好一个插件: {list}");
    let p = &arr[0];
    assert_eq!(p["name"], "demo", "字段级断言 name: {p}");
    assert_eq!(p["version"], "2.0.0", "字段级断言 version: {p}");
    assert_eq!(
        p["description"], "from marketplace",
        "字段级断言 description: {p}"
    );
    assert!(
        p["source"].as_str().unwrap_or_default().contains("demo"),
        "source 应携带分发源(相对路径已 resolve):{p}"
    );
}

#[test]
fn install_from_local_marketplace_lands_on_disk() {
    let _guard = common::state_lock();
    let mkt = write_local_marketplace_fixture();
    // 一键安装(含依赖 DFS;demo 无依赖 → 单条直接装)。
    common::invoke_ok(
        "reflect_install_from_marketplace",
        json!({ "marketplace": mkt, "plugin": "demo" }),
    );
    // 落盘断言 1:installed_plugins.json 记账含 demo。
    let home = common::isolated_home();
    let installed = home
        .join(".zhuye")
        .join("plugins")
        .join("installed_plugins.json");
    let text = std::fs::read_to_string(&installed)
        .unwrap_or_else(|_| panic!("installed_plugins.json 应存在: {}", installed.display()));
    assert!(text.contains("demo"), "记账应含 demo: {text}");
    // 落盘断言 2:缓存布局 cache/<marketplace>/<plugin>/<version>/ 真实物化
    // (与上游 manager 语义一致),plugin.toml 随之就位。
    let cached = home
        .join(".zhuye")
        .join("plugins")
        .join("cache")
        .join("v11-local")
        .join("demo")
        .join("2.0.0")
        .join("plugin.toml");
    assert!(cached.exists(), "缓存物化路径应存在: {}", cached.display());
}

// ============================================================================
// 基建#12 补:token 经 remote_config → status_server 的 IPC 组合路径
// ============================================================================

#[test]
fn status_server_enforces_token_configured_via_ipc() {
    let _guard = common::state_lock();

    // 先确保停机态,再经 IPC 配置 token(remote_config 是 token 的唯一
    // 来源,启动命令体读它 —— 该组合路径此前仅由 status_server 单测
    // 以直接调用覆盖,未经 IPC 命令体链路)。
    common::invoke_ok("reflect_status_server_stop", json!({}));
    common::invoke_ok(
        "reflect_update_remote_config",
        json!({ "host": "127.0.0.1", "port": 4732, "authToken": "v11-secret", "autoConnect": false }),
    );
    let port = common::invoke_ok("reflect_status_server_start", json!({ "port": 0 }))
        .as_u64()
        .expect("启动应返回端口") as u16;

    // HTTP 三态:无 token 401 / 错 token 401 / 对 token(query 形式)200。
    // ipc 测试是同步函数,起一次性 runtime 阻塞驱动(与 harness 的进程级
    // runtime 互不干扰 —— 仅做出站 HTTP)。
    let rt = tokio::runtime::Runtime::new().expect("建临时 runtime");
    let (no_token, wrong, right) = rt.block_on(async {
        let c = reqwest::Client::new();
        let base = format!("http://127.0.0.1:{port}/status");
        let no_token = c.get(&base).send().await.expect("无 token 请求").status();
        let wrong = c
            .get(format!("{base}?token=wrong"))
            .send()
            .await
            .expect("错 token 请求")
            .status();
        let right = c
            .get(format!("{base}?token=v11-secret"))
            .send()
            .await
            .expect("对 token 请求")
            .status();
        (no_token, wrong, right)
    });
    assert_eq!(no_token.as_u16(), 401, "无 token 必须拒绝");
    assert_eq!(wrong.as_u16(), 401, "错 token 必须拒绝");
    assert_eq!(right.as_u16(), 200, "对 token 必须放行");

    // 收尾:停机 + 清 token(测试间不串)。
    common::invoke_ok("reflect_status_server_stop", json!({}));
    common::invoke_ok(
        "reflect_update_remote_config",
        json!({ "host": "127.0.0.1", "port": 4732, "authToken": null, "autoConnect": false }),
    );
}
