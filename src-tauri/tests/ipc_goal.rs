//! 能力覆盖层 · 目标模式快照(v1.7)—— 真实命令体 over 真实 IPC 通路。
//!
//! `reflect_goal_snapshot` 读 `AgentThread::goal_snapshot()`(上游 v1.7
//! 新增的 `GoalController::snapshot()` 读口)。目标模式没有协议事件,
//! 快照是 GUI 判断「是否活跃 / 跑到第几轮 / 累计 token」的唯一权威读口。
//!
//! 本二进制自带 stub provider 配置:controller 挂载只需要 registry 能
//! 解析出 LLM 客户端,**不会发起网络调用**(校验请求只在 goal turn
//! 结束时发生,本套件不开 turn)。

mod common;

use common::{invoke_ok, set_config_before_install};
use serde_json::json;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// 二进制级一次初始化:stub provider 配置 + app 安装。
///
/// 配置必须在**首次** `harness()` 之前就位(见 `common::init_isolated_env`);
/// 本二进制的所有用例共享同一 app,用 `OnceLock` 保证顺序。
static WORLD: OnceLock<()> = OnceLock::new();

fn world() {
    WORLD.get_or_init(|| {
        // base_url 指向必然不可达的端口 —— 挂载阶段不碰它。
        set_config_before_install(
            "[active]\nprovider = \"anthropic\"\n\n[anthropic]\napi_key = \"goal-stub\"\nbase_url = \"http://127.0.0.1:1\"\nmodel = \"claude-goal-stub\"\n\n[hooks]\nenabled = []\n",
        );
        drop(common::harness());
    });
}

/// 轮询直到 `pred(v)` 为真或超时(10s)。
///
/// goal op 经后台 submission loop 异步处理,快照不保证即时可见 ——
/// 「命令已接受」≠「controller 已挂载」。
fn poll_snapshot(pred: impl Fn(&serde_json::Value) -> bool) -> serde_json::Value {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let v = invoke_ok("reflect_goal_snapshot", json!({}));
        if pred(&v) || Instant::now() > deadline {
            return v;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

#[test]
fn goal_snapshot_lifecycle() {
    world();

    // —— 阶段一:未进入目标模式 → null ——
    // (上一条用例遗留的 goal 已随 exit 清空;幂等兜底再退一次。)
    let _ = invoke_ok("reflect_exit_goal_mode", json!({}));
    let v = poll_snapshot(|v| v.is_null());
    assert!(v.is_null(), "未进入目标模式时快照应为 null,实得:{v}");

    // —— 阶段二:进入(最小形态)→ 快照暴露 GoalState ——
    let id = invoke_ok("reflect_enter_goal_mode", json!({ "goal": "让能力覆盖层全绿" }));
    assert!(!id.as_str().unwrap_or_default().is_empty(), "enter 应返回 submission id");

    let v = poll_snapshot(|v| v.is_object());
    assert_eq!(
        v["goal"].as_str(),
        Some("让能力覆盖层全绿"),
        "快照应携带目标文本:{v}"
    );
    assert_eq!(v["status"].as_str(), Some("active"), "初始状态应为 active:{v}");
    assert_eq!(v["turn_count"].as_u64(), Some(0), "尚无 goal turn:{v}");
    assert_eq!(v["tokens_used"].as_u64(), Some(0), "尚无 token 消耗:{v}");
    assert!(v["turns"].is_array(), "校验历史应为数组:{v}");

    // —— 阶段三:完整形态(verifyCommand + tokenBudget,camelCase 线格式)
    // —— 重进覆盖,快照字段逐一对应。
    invoke_ok(
        "reflect_enter_goal_mode",
        json!({ "goal": "第二个目标", "verifyCommand": "cargo test", "tokenBudget": 100_000 }),
    );
    let v = poll_snapshot(|v| v["goal"] == "第二个目标");
    assert_eq!(v["verify_command"].as_str(), Some("cargo test"), "{v}");
    assert_eq!(v["token_budget"].as_u64(), Some(100_000), "{v}");

    // —— 阶段四:退出 → 控制器被 clear → 快照回 null ——
    invoke_ok("reflect_exit_goal_mode", json!({}));
    let v = poll_snapshot(|v| v.is_null());
    assert!(v.is_null(), "退出目标模式后快照应为 null,实得:{v}");
}
