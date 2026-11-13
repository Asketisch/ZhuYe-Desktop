//! 能力覆盖层 · 核心域 —— 真实命令体 over 真实 IPC 通路。
//!
//! 覆盖:探针 / agent 状态 / 配置 / 工具 / 技能 / hooks / 记忆 / 白名单 /
//! 权限规则 / 活动日志 / 会话生命周期 / 统计 / 笔记 / 运行时状态 /
//! agent 定义 / traces。
//!
//! 断言的是**真后端**的返回:不经前端 `invoke` 包装,不经 fakeBackend。

mod common;

use common::{invoke_err, invoke_ok};
use serde_json::json;

// ============================================================================
// 探针与运行时状态
// ============================================================================

#[test]
fn ping_is_alive() {
    let v = invoke_ok("ping", json!({}));
    assert_eq!(v["msg"], "pong");
    assert!(!v["version"].as_str().unwrap_or_default().is_empty());
}

#[test]
fn agent_status_reports_installed_thread() {
    let v = invoke_ok("reflect_agent_status", json!({}));
    // 夹具装过 AgentThread —— ready 必须为 true。
    assert_eq!(v["ready"], true, "agent status: {v}");
    assert!(v["model"].is_string(), "model 字段缺失: {v}");
    assert!(v["workspace"].is_string(), "workspace 字段缺失: {v}");
}

#[test]
fn config_round_trips_through_real_backend() {
    let _guard = common::state_lock();
    let toml = "[active]\nprovider = \"openai\"\n";
    invoke_ok("reflect_save_config", json!({ "toml": toml }));
    let read = invoke_ok("reflect_get_config", json!({}));
    let text = read.as_str().expect("config 必须是字符串");
    assert!(text.contains("openai"), "保存后的配置未读回: {text}");
    // 还原(避免影响同文件内其它用例)。
    invoke_ok("reflect_save_config", json!({ "toml": "" }));
}

#[test]
fn config_info_points_at_a_real_file() {
    let v = invoke_ok("reflect_config_info", json!({}));
    assert!(
        v["path"].is_string() || v["path"].is_null(),
        "path 字段异常: {v}"
    );
}

#[test]
fn credential_pool_status_is_a_list() {
    let v = invoke_ok("reflect_credential_pool_status", json!({}));
    assert!(v.is_array(), "凭证池状态应为数组: {v}");
}

#[test]
fn recovery_state_and_memory_sections_are_lists() {
    assert!(invoke_ok("reflect_recovery_state", json!({})).is_array());
    assert!(invoke_ok("reflect_memory_sections", json!({})).is_array());
}

// ============================================================================
// 工具 / 技能 / hooks
// ============================================================================

#[test]
fn tool_registry_exposes_real_builtin_tools() {
    let v = invoke_ok("reflect_list_tools", json!({}));
    let names: Vec<&str> = v
        .as_array()
        .expect("工具列表应为数组")
        .iter()
        .filter_map(|t| t["name"].as_str())
        .collect();
    for expected in ["bash", "read", "write", "edit", "grep", "glob"] {
        assert!(
            names.contains(&expected),
            "内置工具缺失:{expected};实有={names:?}"
        );
    }
}

#[test]
fn skills_list_is_wellformed() {
    let v = invoke_ok("reflect_list_skills", json!({}));
    assert!(v.is_array(), "技能列表应为数组: {v}");
}

#[test]
fn hook_toggle_round_trips() {
    let before = invoke_ok("reflect_list_hooks", json!({}));
    let hooks = before.as_array().expect("hook 列表应为数组");
    if hooks.is_empty() {
        // 无 hook 时至少断言事件类型表可读。
        assert!(invoke_ok("reflect_list_hook_events", json!({})).is_array());
        return;
    }
    let name = hooks[0]["name"].as_str().expect("hook 缺少 name");
    let was_enabled = hooks[0]["enabled"].as_bool().unwrap_or(false);
    invoke_ok(
        "reflect_toggle_hook",
        json!({ "name": name, "enabled": !was_enabled }),
    );
    let after = invoke_ok("reflect_list_hooks", json!({}));
    let found = after
        .as_array()
        .expect("hook 列表应为数组")
        .iter()
        .find(|h| h["name"] == name)
        .expect("切换后 hook 消失");
    assert_eq!(found["enabled"], !was_enabled, "hook 状态未翻转: {found}");
    // 还原。
    invoke_ok(
        "reflect_toggle_hook",
        json!({ "name": name, "enabled": was_enabled }),
    );
}

// ============================================================================
// 记忆
// ============================================================================

#[test]
fn memory_add_list_remove_round_trip() {
    let _guard = common::state_lock();
    let scope = "project";
    let key = "capability-layer-probe";
    invoke_ok(
        "reflect_add_memory",
        json!({ "scope": scope, "key": key, "value": "pnpm test" }),
    );

    let list = invoke_ok("reflect_list_memory", json!({}));
    let entries = list.as_array().expect("记忆列表应为数组");
    let hit = entries
        .iter()
        .find(|e| e["scope"] == scope && e["key"] == key)
        .expect("新增的记忆条目未出现在列表里");
    let value = hit["value"].as_str().expect("记忆 value 应为字符串");
    assert!(value.contains("pnpm test"), "记忆正文缺少 value: {value}");

    invoke_ok(
        "reflect_add_memory",
        json!({ "scope": scope, "key": key, "value": "updated" }),
    );
    invoke_err(
        "reflect_add_memory",
        json!({ "scope": scope, "key": key, "value": "replacement", "createOnly": true }),
    );
    let updated = invoke_ok("reflect_list_memory", json!({}));
    let hit = updated
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["scope"] == scope && e["key"] == key)
        .unwrap();
    assert_eq!(hit["value"], "updated");

    // 删除是**删块**:整段 `## <key>` 被摘掉。
    invoke_ok(
        "reflect_remove_memory",
        json!({ "scope": scope, "key": key }),
    );
    let after = invoke_ok("reflect_list_memory", json!({}));
    let still = after
        .as_array()
        .expect("记忆列表应为数组")
        .iter()
        .find(|e| e["scope"] == scope && e["key"] == key)
        .map(|e| e["value"].as_str().unwrap_or_default().to_string())
        .unwrap_or_default();
    assert!(!still.contains(key), "删除后正文仍含 key: {still}");
}

#[test]
fn memory_edit_and_delete_reject_stale_entry_values() {
    let _guard = common::state_lock();
    let key = "stale-memory-probe";
    invoke_ok(
        "reflect_add_memory",
        json!({ "scope": "project", "key": key, "value": "initial" }),
    );
    let list = invoke_ok("reflect_list_memory", json!({}));
    let old = list
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["scope"] == "project" && entry["key"] == key)
        .unwrap()["value"]
        .as_str()
        .unwrap()
        .to_string();
    invoke_ok(
        "reflect_add_memory",
        json!({ "scope": "project", "key": key, "value": "newer" }),
    );
    invoke_err(
        "reflect_add_memory",
        json!({ "scope": "project", "key": key, "value": "stale edit", "expectedValue": old }),
    );
    invoke_err(
        "reflect_remove_memory",
        json!({ "scope": "project", "key": key, "expectedValue": old }),
    );
    let current = invoke_ok("reflect_list_memory", json!({}));
    assert!(
        current
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["key"] == key && entry["value"] == "newer")
    );
    invoke_ok(
        "reflect_remove_memory",
        json!({ "scope": "project", "key": key, "expectedValue": "newer" }),
    );
    invoke_err(
        "reflect_add_memory",
        json!({ "scope": "project", "key": key, "value": "resurrected", "expectedValue": "newer" }),
    );
}

#[test]
fn unknown_memory_scope_is_rejected() {
    // 非法 scope 必须报错 —— 否则会静默写错地方。
    let e = invoke_err(
        "reflect_add_memory",
        json!({ "scope": "no-such-scope", "key": "k", "value": "v" }),
    );
    assert!(!e.is_null(), "错误响应不应为 null");
}

#[test]
fn memory_rejects_stale_workspace_or_agent_context() {
    let _guard = common::state_lock();
    let workspace = common::agent().workspace().display().to_string();
    let name = invoke_ok("reflect_get_active_agent", json!({}))["name"]
        .as_str()
        .unwrap()
        .to_string();
    let valid = json!({ "workspace": workspace, "agent": name });
    let key = "context-validation-probe";
    invoke_ok(
        "reflect_add_memory",
        json!({ "scope": "project", "key": key, "value": "original", "expectedContext": valid }),
    );
    let wrong_workspace = json!({ "workspace": "/does-not-match-workspace", "agent": name });
    let wrong_agent = json!({ "workspace": workspace, "agent": "does-not-match-agent" });
    for context in [wrong_workspace, wrong_agent] {
        invoke_err("reflect_list_memory", json!({ "expectedContext": context }));
        invoke_err(
            "reflect_memory_sections",
            json!({ "expectedContext": context }),
        );
        invoke_err(
            "reflect_add_memory",
            json!({ "scope": "project", "key": key, "value": "wrong", "expectedContext": context }),
        );
        invoke_err(
            "reflect_remove_memory",
            json!({ "scope": "project", "key": key, "expectedContext": context }),
        );
    }
    let list = invoke_ok("reflect_list_memory", json!({ "expectedContext": valid }));
    assert!(
        list.as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["key"] == key
                && entry["value"].as_str().unwrap().trim_end() == "original")
    );
    invoke_ok(
        "reflect_remove_memory",
        json!({ "scope": "project", "key": key, "expectedContext": valid }),
    );
}

#[test]
fn memory_sections_preserve_core_titles_indices_and_bodies() {
    let _guard = common::state_lock();
    let agent = common::agent();
    let name = invoke_ok("reflect_get_active_agent", json!({}))["name"]
        .as_str()
        .unwrap()
        .to_string();
    let workspace = agent.workspace();
    let path = reflect_memory::resolve_path(
        reflect_memory::MemoryScope::Project,
        &workspace,
        &common::isolated_home(),
        &name,
    )
    .unwrap();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let previous = std::fs::read(&path).ok();
    let content = "preamble\n## first\n正文  \n## second\nsecond body\n";
    std::fs::write(&path, content).unwrap();
    let expected = reflect_memory::split_sections(reflect_memory::MemoryScope::Project, content);
    let list = invoke_ok(
        "reflect_memory_sections",
        json!({ "expectedContext": { "workspace": workspace, "agent": name } }),
    );
    let project: Vec<_> = list
        .as_array()
        .unwrap()
        .iter()
        .filter(|s| s["scope"] == "project")
        .collect();
    assert_eq!(project.len(), expected.len());
    for (actual, section) in project.iter().zip(expected) {
        assert_eq!(actual["title"], section.title);
        assert_eq!(actual["body"], section.body);
        assert_eq!(actual["index"], section.index);
        assert_eq!(actual["chars"], section.body.chars().count());
    }
    if let Some(bytes) = previous {
        std::fs::write(path, bytes).unwrap();
    } else {
        std::fs::remove_file(path).unwrap();
    }
}

#[test]
fn legacy_memory_document_can_be_edited_and_removed_over_ipc() {
    let _guard = common::state_lock();
    let agent = common::agent();
    let name = invoke_ok("reflect_get_active_agent", json!({}))["name"]
        .as_str()
        .unwrap()
        .to_string();
    let path = reflect_memory::resolve_path(
        reflect_memory::MemoryScope::Project,
        &agent.workspace(),
        &common::isolated_home(),
        &name,
    )
    .unwrap();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let previous = std::fs::read(&path).ok();
    std::fs::write(&path, "legacy document").unwrap();
    let list = invoke_ok("reflect_list_memory", json!({}));
    let entry = list
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["scope"] == "project" && e["wholeDocument"] == true)
        .unwrap();
    assert_eq!(entry["value"], "legacy document");
    std::fs::write(&path, "changed externally").unwrap();
    invoke_err(
        "reflect_add_memory",
        json!({ "scope": "project", "key": "(all)", "value": "stale document", "replaceDocument": true, "expectedValue": "legacy document" }),
    );
    invoke_err(
        "reflect_remove_memory",
        json!({ "scope": "project", "key": "(all)", "replaceDocument": true, "expectedValue": "legacy document" }),
    );
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "changed externally"
    );
    invoke_ok(
        "reflect_add_memory",
        json!({ "scope": "project", "key": "(all)", "value": "updated document", "replaceDocument": true, "expectedValue": "changed externally" }),
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "updated document");
    invoke_ok(
        "reflect_remove_memory",
        json!({ "scope": "project", "key": "(all)", "replaceDocument": true, "expectedValue": "updated document" }),
    );
    assert!(!path.exists());
    if let Some(bytes) = previous {
        std::fs::write(path, bytes).unwrap();
    }
}

// ============================================================================
// 审批白名单
// ============================================================================

#[test]
fn allowlist_save_load_check_round_trip() {
    let list = json!({ "prefixes": ["capability-layer-probe"] });
    invoke_ok("reflect_save_allowlist", json!({ "list": list }));
    let loaded = invoke_ok("reflect_load_allowlist", json!({}));
    let prefixes = loaded["prefixes"]
        .as_array()
        .expect("allowlist 缺少 prefixes 数组")
        .iter()
        .filter_map(|p| p.as_str())
        .collect::<Vec<_>>();
    assert!(
        prefixes.contains(&"capability-layer-probe"),
        "白名单未读回:{prefixes:?}"
    );

    let checked = invoke_ok(
        "reflect_check_allowlist",
        json!({ "prefix": "capability-layer-probe" }),
    );
    assert_eq!(checked, true, "白名单前缀未命中");

    invoke_ok(
        "reflect_save_allowlist",
        json!({ "list": { "prefixes": [] } }),
    );
}

// ============================================================================
// 权限规则
// ============================================================================

#[test]
fn permission_rules_are_listable_and_appendable() {
    let _guard = common::state_lock();
    let before = invoke_ok("reflect_list_permission_rules", json!({}));
    assert!(before.is_array(), "权限规则应为数组: {before}");

    invoke_ok(
        "reflect_add_permission_rule",
        json!({ "rule": { "tool": "CapabilityProbe", "action": "allow" } }),
    );
    let after = invoke_ok("reflect_list_permission_rules", json!({}));
    let hit = after
        .as_array()
        .expect("权限规则应为数组")
        .iter()
        .find(|r| r["tool"] == "CapabilityProbe")
        .expect("新增的权限规则未出现在列表里");
    assert_eq!(hit["action"], "allow", "权限规则动作不符: {hit}");
}

// ============================================================================
// 活动日志
// ============================================================================

#[test]
fn activity_log_is_queryable() {
    let count = invoke_ok("reflect_activity_count", json!({}));
    assert!(count.as_u64().is_some(), "活动计数应为数字: {count}");
    assert!(invoke_ok("reflect_list_activity", json!({})).is_array());
    assert!(invoke_ok("reflect_search_activity", json!({ "query": "probe" })).is_array());
}

#[test]
fn activity_can_be_cleared() {
    invoke_ok("reflect_clear_activity", json!({}));
    let count = invoke_ok("reflect_activity_count", json!({}));
    assert_eq!(count, 0, "清空后计数仍非零: {count}");
}

// ============================================================================
// 会话生命周期
// ============================================================================

#[test]
fn session_create_list_rename_delete() {
    let id = invoke_ok("reflect_create_session", json!({}));
    let id = id.as_str().expect("session id 应为字符串").to_string();
    assert!(!id.is_empty(), "session id 为空");

    let list = invoke_ok("reflect_list_sessions", json!({}));
    assert!(list.is_array(), "会话列表应为数组: {list}");

    invoke_ok(
        "reflect_rename_session",
        json!({ "id": id, "newName": "能力覆盖层改名" }),
    );
    invoke_ok("reflect_delete_session", json!({ "id": id }));
}

#[cfg(any(target_os = "macos", target_os = "linux", target_os = "android"))]
#[test]
fn session_rename_rejects_a_symlink_to_an_external_file() {
    let id = invoke_ok("reflect_create_session", json!({}));
    let directory = reflect_rollout::path::default_base().join("_names");
    std::fs::create_dir_all(&directory).unwrap();
    let outside = tempfile::tempdir().unwrap();
    let target = outside.path().join("protected");
    std::fs::write(&target, "original").unwrap();
    let link = directory.join(format!("{}.name", id.as_str().unwrap()));
    std::os::unix::fs::symlink(&target, &link).unwrap();
    invoke_err(
        "reflect_rename_session",
        json!({"id": id, "newName": "replacement"}),
    );
    assert_eq!(std::fs::read_to_string(target).unwrap(), "original");
    assert!(
        std::fs::symlink_metadata(link)
            .unwrap()
            .file_type()
            .is_symlink()
    );
}

#[test]
fn session_archive_and_unarchive_round_trip() {
    let id = invoke_ok("reflect_create_session", json!({}));
    let id = id.as_str().expect("session id 应为字符串").to_string();

    // `reflect_create_session` 只**分配 id**,不落盘 —— 归档搬的是磁盘上的
    // 文件,所以先造一条真 rollout,否则归档是 no-op(后端日志里是
    // "not found (no-op)")。
    seed_rollout(&id);

    invoke_ok("reflect_archive_session", json!({ "id": id }));
    let archived = invoke_ok("reflect_list_archived_sessions", json!({}));
    assert!(
        archived
            .as_array()
            .expect("归档列表应为数组")
            .iter()
            .any(|s| s["session_id"] == id),
        "归档后未出现在归档列表里"
    );

    invoke_ok("reflect_unarchive_session", json!({ "id": id }));
    let archived_after = invoke_ok("reflect_list_archived_sessions", json!({}));
    assert!(
        !archived_after
            .as_array()
            .expect("归档列表应为数组")
            .iter()
            .any(|s| s["session_id"] == id),
        "取消归档后仍在归档列表里"
    );
}

/// 在 rollout 根目录里造一条真会话记录(`<base>/YYYY/MM/DD/<id>.jsonl`)。
///
/// 首行必须是**合法的** `RolloutRecord::SessionMeta`(`session_id` /
/// `model` / `started_at` 三个必填字段)—— 会话索引靠它建条目,首行不合法
/// 的话文件会被索引跳过,归档后也列不出来。
fn seed_rollout(id: &str) {
    let home = std::env::var("HOME").expect("HOME 未隔离");
    let now = chrono::Utc::now();
    let dir = std::path::Path::new(&home)
        .join(".zhuye/sessions")
        .join(now.format("%Y").to_string())
        .join(now.format("%m").to_string())
        .join(now.format("%d").to_string());
    std::fs::create_dir_all(&dir).expect("create rollout dir");
    let meta = serde_json::json!({
        "type": "session_meta",
        "session_id": id,
        "model": "probe/model",
        "started_at": now.to_rfc3339(),
    });
    std::fs::write(dir.join(format!("{id}.jsonl")), format!("{meta}\n"))
        .expect("write rollout file");
}

#[test]
fn session_search_accepts_query_and_limit() {
    let v = invoke_ok(
        "reflect_search_sessions",
        json!({ "query": "probe", "limit": 5 }),
    );
    assert!(v.is_array(), "会话搜索应为数组: {v}");
}

#[test]
fn session_stats_and_model_usage_are_readable() {
    // 统计类命令对不存在的会话返回 None / 空列表,不应报错。
    let v = invoke_ok(
        "reflect_session_stats",
        json!({ "id": "00000000-0000-0000-0000-000000000000" }),
    );
    assert!(v.is_null() || v.is_object(), "会话统计形态异常: {v}");
    assert!(invoke_ok("reflect_all_model_usage", json!({})).is_array());
    let cards = invoke_ok("reflect_model_rate_cards", json!({ "models": ["gpt-4o"] }));
    assert!(cards.is_array(), "费率卡应为数组: {cards}");
}

#[test]
fn invalid_session_id_is_rejected_not_panicked() {
    // 非 UUID 的 id 必须返回结构化错误,而不是让后端 panic。
    let e = invoke_err("reflect_delete_session", json!({ "id": "not-a-uuid" }));
    assert!(!e.is_null(), "错误响应不应为 null");
}

// ============================================================================
// 笔记
// ============================================================================

#[test]
fn session_notes_readable() {
    let _guard = common::state_lock();
    let v = invoke_ok(
        "reflect_list_session_notes",
        json!({ "id": "00000000-0000-0000-0000-000000000000" }),
    );
    assert!(v.is_array(), "会话笔记应为数组: {v}");
    assert!(invoke_ok("reflect_list_note_sessions", json!({})).is_array());
}

#[test]
fn session_notes_preserve_timestamps_and_match_session_counts() {
    let _guard = common::state_lock();
    let _ = common::agent();
    let id = "88888888-8888-4888-8888-888888888888";
    let dir = reflect_notes::resolve_notes_home()
        .unwrap()
        .join("session-notes");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(format!("{id}.jsonl"));
    let mut lines = Vec::new();
    for i in 0..35 {
        lines.push(
            json!({ "text": format!("note {i}"), "created_at": "2020-01-02T03:04:05Z" })
                .to_string(),
        );
    }
    lines.push("{broken".to_string());
    lines.push(json!({ "text": "  ", "created_at": "2021-01-01T00:00:00Z" }).to_string());
    std::fs::write(&path, lines.join("\n")).unwrap();
    let notes = invoke_ok("reflect_list_session_notes", json!({ "id": id }));
    let notes = notes.as_array().unwrap();
    let core = reflect_notes::FileBackedNoteStore::open_or_create_default(&path).unwrap();
    let core_notes = reflect_notes::NoteStore::list(&core);
    assert_eq!(notes.len(), core_notes.len());
    for (actual, core_note) in notes.iter().zip(core_notes) {
        assert_eq!(actual["text"], core_note.text);
    }
    assert_eq!(notes.len(), 30);
    assert_eq!(notes[0]["text"], "note 5");
    assert_eq!(notes.last().unwrap()["text"], "note 34");
    assert_eq!(notes[0]["createdAt"], "2020-01-02T03:04:05+00:00");
    let sessions = invoke_ok("reflect_list_note_sessions", json!({}));
    let session = sessions
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["sessionId"] == id)
        .unwrap();
    assert_eq!(session["count"], 30);
    assert_eq!(session["updatedAt"], notes.last().unwrap()["createdAt"]);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn session_note_read_errors_are_reported() {
    let _guard = common::state_lock();
    let _ = common::agent();
    let id = "99999999-9999-4999-8999-999999999999";
    let dir = reflect_notes::resolve_notes_home()
        .unwrap()
        .join("session-notes");
    let path = dir.join(format!("{id}.jsonl"));
    std::fs::create_dir_all(&path).unwrap();
    invoke_err("reflect_list_session_notes", json!({ "id": id }));
    invoke_err("reflect_list_note_sessions", json!({}));
    std::fs::remove_dir(path).unwrap();
}

// ============================================================================
// Agent 定义
// ============================================================================

#[test]
fn agent_definitions_crud() {
    let def = json!({
        "name": "capability-probe",
        "description": "能力覆盖层探针",
        "prompt": "你是探针。",
    });
    let saved = invoke_ok("reflect_save_agent_def", json!({ "def": def }));
    assert_eq!(saved["name"], "capability-probe", "保存后名称不符: {saved}");

    let got = invoke_ok(
        "reflect_get_agent_def",
        json!({ "name": "capability-probe" }),
    );
    assert_eq!(got["name"], "capability-probe", "读回名称不符: {got}");

    let list = invoke_ok("reflect_list_agent_defs", json!({}));
    assert!(list.is_array(), "agent 定义列表应为数组: {list}");

    let deleted = invoke_ok(
        "reflect_delete_agent_def",
        json!({ "name": "capability-probe" }),
    );
    assert_eq!(deleted, true, "删除未返回 true");
}

#[test]
fn agent_create_only_does_not_overwrite_existing_definition() {
    let original = json!({ "name": "create-only-probe", "description": "original" });
    let replacement = json!({ "name": "create-only-probe", "description": "replacement" });
    invoke_ok(
        "reflect_save_agent_def",
        json!({ "def": original, "createOnly": true }),
    );
    invoke_err(
        "reflect_save_agent_def",
        json!({ "def": replacement, "createOnly": true }),
    );
    let retained = invoke_ok(
        "reflect_get_agent_def",
        json!({ "name": "create-only-probe" }),
    );
    assert_eq!(retained["description"], "original");
    invoke_ok("reflect_save_agent_def", json!({ "def": replacement }));
    let updated = invoke_ok(
        "reflect_get_agent_def",
        json!({ "name": "create-only-probe" }),
    );
    assert_eq!(updated["description"], "replacement");
}

#[test]
fn agent_markdown_is_parsed() {
    let md = "---\nname: probe-md\ndescription: 解析探针\n---\n\n正文。\n";
    let def = invoke_ok("reflect_parse_agent_md", json!({ "text": md }));
    assert_eq!(def["name"], "probe-md", "frontmatter 名称未解析: {def}");
    assert!(def["description"].is_string(), "description 缺失: {def}");
}

#[test]
fn active_agent_is_readable_and_settable() {
    let before = invoke_ok("reflect_get_active_agent", json!({}));
    assert!(before.is_object(), "活跃 agent 应为对象: {before}");
    let name = before["name"].as_str().unwrap_or("").to_string();
    if !name.is_empty() {
        let after = invoke_ok("reflect_set_active_agent", json!({ "name": name }));
        assert_eq!(after["name"], name, "切换活跃 agent 后名称不符: {after}");
    }
}

// ============================================================================
// Autopilot
// ============================================================================

#[test]
fn autopilot_config_round_trips() {
    let before = invoke_ok("reflect_get_autopilot_config", json!({}));
    assert!(before.is_object(), "autopilot 配置应为对象: {before}");
    invoke_ok(
        "reflect_update_autopilot_config",
        json!({ "config": before }),
    );
    let history = invoke_ok("reflect_autopilot_history", json!({}));
    assert!(history.is_array(), "autopilot 历史应为数组: {history}");
}

// ============================================================================
// Traces / span 日志
// ============================================================================

#[test]
fn traces_and_span_logs_are_readable() {
    assert!(invoke_ok("reflect_list_traces", json!({ "limit": 5 })).is_array());
    // 不存在的 trace → 结构化错误("trace session not found"),不得 panic。
    let e = invoke_err("reflect_get_trace", json!({ "id": "capability-probe" }));
    assert!(!e.is_null(), "错误响应不应为 null");
    assert!(invoke_ok("reflect_list_span_logs", json!({ "days": 1 })).is_array());
    assert!(
        invoke_ok("reflect_read_span_log", json!({ "day": "1970-01-01" })).is_array(),
        "读取不存在的 span 日志应返回空数组"
    );
}
