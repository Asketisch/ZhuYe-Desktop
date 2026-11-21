//! 能力覆盖层 · 挂起交互查询面(v1.12)—— 真实命令体 over 真实 IPC 通路。
//!
//! 覆盖:`zhuye_bind_session` 返回结构的有意协议扩展(单一 mode 字符串 →
//! `{permission_mode, pending_gates}`)。引擎侧 gate 真相(注册表 /
//! 审计落盘 / InteractionResolved 广播)由上游 zhuye-tools / zhuye-core
//! 测试覆盖;本套件锁定桌面线格式契约 —— reload / 换绑后前端据此
//! 重新水合审批 UI,不再依赖前端内存投影。

mod common;

use common::invoke_ok;
use serde_json::json;

#[test]
fn bind_returns_structured_output_with_pending_gates() {
    // 新会话 → bind → 返回必须是结构体,而非裸 mode 字符串(v1.12 前形态)。
    let session = invoke_ok("zhuye_create_session", json!({}));
    let id = session.as_str().unwrap_or_default();
    assert!(!id.is_empty(), "create_session 应返回会话 id");
    let out = invoke_ok("zhuye_bind_session", json!({ "id": session }));
    let obj = out.as_object().expect("bind 应返回结构体");
    assert!(
        obj.contains_key("permission_mode"),
        "bind 返回必须含 permission_mode: {out}"
    );
    let gates = obj
        .get("pending_gates")
        .and_then(|v| v.as_array())
        .expect("bind 返回必须含 pending_gates 数组");
    assert!(
        gates.is_empty(),
        "新会话必须无挂起交互(引擎注册表权威):{gates:?}"
    );
}

#[test]
fn bind_unknown_session_returns_empty_pending_gates() {
    // 未知 id(磁盘无对应 JSONL)→ 空历史绑定 + 空 pending,与 New Chat
    // 的 create → navigate → bind 序列兼容。用全零 UUID(合法格式但磁盘
    // 上不会有该会话文件)。
    let out = invoke_ok(
        "zhuye_bind_session",
        json!({ "id": "00000000-0000-0000-0000-000000000000" }),
    );
    let obj = out.as_object().expect("未知 id 绑定仍应成功(空历史分支)");
    assert!(
        obj.get("pending_gates")
            .and_then(|v| v.as_array())
            .is_some_and(|g| g.is_empty()),
        "未知会话的 pending_gates 必须为空数组: {out}"
    );
}
