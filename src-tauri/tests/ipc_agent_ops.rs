//! 能力覆盖层 · Agent 生命周期 —— 真实命令体 over 真实 IPC 通路。
//!
//! 覆盖:提交 / 中断 / 压缩 / 回退 / 关闭 / 工具审批 / Hook 审批 /
//! plan 模式 / 计划审批 / effort / 权限模式 / 追问 / steer /
//! goal 模式 / 子代理查询 / 会话绑定 / 分叉 / 标题生成。
//!
//! 这些命令都经 `AgentThread` 的 Op 通道投递,**立即**返回 submission id,
//! 真正的 turn 在后台跑 —— 所以断言点放在「命令被接受 + 返回了 id」,
//! 以及「非法输入被结构化拒绝」。

mod common;

use common::{invoke_err, invoke_ok};
use serde_json::json;

/// 断言一条 Op 命令返回了非空 submission id。
fn assert_submission_id(v: &serde_json::Value) {
    let id = v.as_str().unwrap_or_default();
    assert!(!id.is_empty(), "Op 命令应返回 submission id,实得:{v}");
}

// ============================================================================
// 提交与中断
// ============================================================================

#[test]
fn submit_accepts_a_wellformed_submission() {
    let submission = json!({
        "id": "capability-probe-sub",
        "op": { "type": "user_input", "items": [{ "type": "text", "text": "探针" }] },
    });
    let v = invoke_ok("reflect_submit", json!({ "submission": submission }));
    assert!(v.is_string(), "submit 应返回 submission id: {v}");
}

#[test]
fn submit_rejects_malformed_submission() {
    // 缺 op → 结构化错误,不得 panic。
    let e = invoke_err("reflect_submit", json!({ "submission": { "id": "x" } }));
    assert!(!e.is_null(), "错误响应不应为 null");
}

#[test]
fn interrupt_is_idempotent() {
    invoke_ok("reflect_interrupt", json!({}));
    invoke_ok("reflect_interrupt", json!({}));
}

// ============================================================================
// 压缩 / 回退 / 关闭
// ============================================================================

#[test]
fn compact_rewind_shutdown_are_accepted() {
    assert_submission_id(&invoke_ok("reflect_compact", json!({})));
    assert_submission_id(&invoke_ok("reflect_rewind", json!({})));
    assert_submission_id(&invoke_ok(
        "reflect_rewind",
        json!({ "toTurnId": "turn-probe" }),
    ));
    assert_submission_id(&invoke_ok("reflect_shutdown", json!({})));
}

// ============================================================================
// 审批
// ============================================================================

#[test]
fn tool_approval_accepts_all_decision_shapes() {
    // 三种决定形态:approve / deny{reason} / approve_for_session。
    for decision in [
        json!("approve"),
        json!({ "deny": { "reason": "探针拒绝" } }),
        json!("approve_for_session"),
    ] {
        let v = invoke_ok(
            "reflect_tool_approval",
            json!({ "id": "apr-probe", "decision": decision }),
        );
        assert_submission_id(&v);
    }
}

#[test]
fn hook_approval_accepts_all_decision_shapes() {
    for decision in [json!("approve"), json!("approve_for_session")] {
        let v = invoke_ok(
            "reflect_hook_approval",
            json!({ "id": "hk-probe", "decision": decision }),
        );
        assert_submission_id(&v);
    }
}

#[test]
fn invalid_approval_decision_is_rejected() {
    let e = invoke_err(
        "reflect_tool_approval",
        json!({ "id": "apr-probe", "decision": "nonsense" }),
    );
    assert!(!e.is_null(), "错误响应不应为 null");
}

// ============================================================================
// Plan 模式
// ============================================================================

#[test]
fn plan_mode_enter_and_exit() {
    assert_submission_id(&invoke_ok(
        "reflect_enter_plan_mode",
        json!({ "task": "能力覆盖层 plan 探针" }),
    ));
    assert_submission_id(&invoke_ok("reflect_exit_plan_mode", json!({})));
}

#[test]
fn plan_approval_accepts_all_three_choices() {
    for choice in [json!("auto_mode"), json!("manual_approve"), json!("revise")] {
        let v = invoke_ok(
            "reflect_plan_approval",
            json!({ "id": "plan-probe", "choice": choice }),
        );
        assert_submission_id(&v);
    }
}

// ============================================================================
// Effort / 权限模式
// ============================================================================

#[test]
fn effort_accepts_valid_levels_and_rejects_invalid() {
    for level in ["low", "medium", "high", "HIGH"] {
        let v = invoke_ok("reflect_set_effort", json!({ "level": level }));
        assert_submission_id(&v);
    }
    let e = invoke_err("reflect_set_effort", json!({ "level": "extreme" }));
    assert!(!e.is_null(), "非法 effort 必须报错");
}

#[test]
fn effort_is_readable() {
    let v = invoke_ok("reflect_get_effort", json!({}));
    assert!(v.is_string(), "effort 应为字符串: {v}");
}

#[test]
fn permission_mode_accepts_known_modes() {
    for mode in [
        "auto",
        "prompt",
        "deny",
        "plan",
        "accept_edits",
        "bubble",
        "bypass",
    ] {
        let v = invoke_ok("reflect_set_permission_mode", json!({ "mode": mode }));
        assert_submission_id(&v);
    }
    let e = invoke_err("reflect_set_permission_mode", json!({ "mode": "nonsense" }));
    assert!(!e.is_null(), "非法权限模式必须报错");
}

#[test]
fn permission_mode_can_be_cycled() {
    let v = invoke_ok("reflect_cycle_permission_mode", json!({}));
    assert_submission_id(&v);
}

// ============================================================================
// 追问(问题 / 文本)
// ============================================================================

#[test]
fn ask_user_responses_are_accepted() {
    let v = invoke_ok(
        "reflect_ask_user_question_response",
        json!({ "id": "q-probe", "answers": { "answers": [{ "indices": [0] }] } }),
    );
    assert_submission_id(&v);

    let v = invoke_ok(
        "reflect_ask_user_input_response",
        json!({ "id": "q-probe-2", "text": "探针回答" }),
    );
    assert_submission_id(&v);
}

// ============================================================================
// Steer
// ============================================================================

#[test]
fn steer_accepts_items() {
    let v = invoke_ok(
        "reflect_steer",
        json!({ "items": [{ "type": "text", "text": "补充说明" }] }),
    );
    assert_submission_id(&v);
}

#[test]
fn steer_rejects_malformed_items() {
    let e = invoke_err("reflect_steer", json!({ "items": "not-an-array" }));
    assert!(!e.is_null(), "错误响应不应为 null");
}

// ============================================================================
// Goal 模式
// ============================================================================

#[test]
fn goal_mode_enter_and_exit() {
    // 最小形态:仅 goal 必填。
    let v = invoke_ok(
        "reflect_enter_goal_mode",
        json!({ "goal": "让能力覆盖层全绿" }),
    );
    assert_submission_id(&v);

    // 完整形态:校验命令 + token 预算(camelCase 线格式)。
    let v = invoke_ok(
        "reflect_enter_goal_mode",
        json!({ "goal": "让能力覆盖层全绿", "verifyCommand": "cargo test", "tokenBudget": 100_000 }),
    );
    assert_submission_id(&v);

    assert_submission_id(&invoke_ok("reflect_exit_goal_mode", json!({})));
}

// ============================================================================
// 子代理查询
// ============================================================================

#[test]
fn subagent_query_is_readable() {
    let v = invoke_ok("reflect_query_subagents", json!({}));
    assert!(v.is_string(), "子代理查询应返回字符串: {v}");
    let v = invoke_ok(
        "reflect_query_subagents",
        json!({ "childId": "no-such-child" }),
    );
    assert!(v.is_string(), "子代理查询应返回字符串: {v}");
}

// ============================================================================
// 会话绑定 / 分叉 / 标题
// ============================================================================

#[test]
fn bind_session_accepts_unknown_id_without_erroring() {
    // 未知 id(磁盘上无 JSONL)→ 后端走空历史分支,**不报错**(见
    // reflect_bind_session 的文档注释)。
    let v = invoke_ok(
        "reflect_bind_session",
        json!({ "id": "00000000-0000-0000-0000-000000000001" }),
    );
    assert!(v.is_string(), "bind 应返回权限模式字符串: {v}");
}

#[test]
fn fork_session_of_missing_session_is_rejected_or_empty() {
    // 不存在的会话 → 结构化错误或空 id,不得 panic。
    let out = common::invoke(
        "reflect_fork_session",
        json!({ "id": "00000000-0000-0000-0000-000000000002" }),
    );
    match out {
        Ok(v) => assert!(v.is_string(), "fork 应返回字符串: {v}"),
        Err(e) => assert!(!e.is_null(), "错误响应不应为 null"),
    }
}

#[test]
fn generate_session_title_requires_a_user_message() {
    // 空会话没有可归纳的用户消息 → 结构化错误("session has no user
    // message to summarize"),不得 panic。这条守住的是**前置守卫**。
    let e = invoke_err(
        "reflect_generate_session_title",
        json!({ "id": "00000000-0000-0000-0000-000000000003", "force": true }),
    );
    assert!(!e.is_null(), "错误响应不应为 null");
}
