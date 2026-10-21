//! 能力覆盖层 · 领域管理域 —— 真实命令体 over 真实 IPC 通路。
//!
//! 覆盖:任务 / 团队 / squad / 定时任务 / 插件 / 子代理 spec / MCP /
//! LSP / 提示词层 / KMS 知识库 / side-channel / 讨论 / 流水线。
//!
//! 这些域都写 `~/.reflect/**` —— 夹具已把 HOME / REFLECT_HOME 指向临时
//! 目录,不会污染真实数据。用例用**唯一名字**,避免互相撞名。

mod common;

use common::{invoke, invoke_err, invoke_ok};
use serde_json::json;

/// 本文件内所有写操作用的后缀 —— 保证并发用例之间不撞名。
fn tag() -> String {
    format!("p{}", std::process::id())
}

// ============================================================================
// 任务
// ============================================================================

#[test]
fn task_crud_round_trip() {
    let _guard = common::state_lock();
    let list = "default";
    let subject = format!("能力覆盖层任务 {}", tag());

    let created = invoke_ok(
        "reflect_create_task",
        json!({ "list": list, "subject": subject, "description": "真后端创建" }),
    );
    let id = created["id"].as_u64().expect("任务缺少数字 id");
    assert_eq!(created["subject"], subject, "任务主题不符: {created}");
    assert_eq!(
        created["status"], "pending",
        "新任务状态应为 pending: {created}"
    );

    // 读回
    let got = invoke_ok("reflect_get_task", json!({ "list": list, "id": id }));
    assert_eq!(got["subject"], subject, "读回主题不符: {got}");

    // 列表
    let all = invoke_ok("reflect_list_tasks", json!({ "list": list }));
    assert!(
        all.as_array()
            .expect("任务列表应为数组")
            .iter()
            .any(|t| t["id"] == id),
        "任务未出现在列表里"
    );

    // 更新
    let updated = invoke_ok(
        "reflect_update_task",
        json!({ "list": list, "id": id, "patch": { "status": "in_progress" } }),
    );
    assert!(
        updated.to_string().contains("in_progress"),
        "状态未更新: {updated}"
    );

    // 认领 / 释放
    let claimed = invoke_ok(
        "reflect_claim_task",
        json!({ "list": list, "claimer": "probe@team" }),
    );
    assert!(
        claimed.is_object() || claimed.is_null(),
        "认领结果形态异常: {claimed}"
    );
    // 释放未认领的任务 → 结构化错误("nothing to release"),不得 panic。
    // 这里只验「不崩」:任务是否真被认领取决于上一条的结果。
    let released = common::invoke("reflect_release_task", json!({ "list": list, "id": id }));
    match released {
        Ok(v) => assert!(!v.is_null(), "释放结果不应为 null"),
        Err(e) => assert!(!e.is_null(), "错误响应不应为 null"),
    }
    invoke_ok("reflect_stop_task", json!({ "list": list, "id": id }));
    let out = invoke_ok("reflect_get_task_output", json!({ "list": list, "id": id }));
    assert!(out.is_string(), "任务输出应为字符串: {out}");

    // 删除
    invoke_ok("reflect_delete_task", json!({ "list": list, "id": id }));
}

// ============================================================================
// 团队
// ============================================================================

#[test]
fn team_upsert_get_delete() {
    let _guard = common::state_lock();
    let name = format!("probe-team-{}", tag());
    let team = json!({
        "name": name,
        "description": "能力覆盖层团队",
        "lead_agent_id": format!("team-lead@{name}"),
        "members": [{
            "agent_id": format!("builder@{name}"),
            "name": "builder",
            "role": "builder",
            "system_prompt": "你负责实现。",
            "allowed_tools": [],
            // joined_at 是**必填**字段(SystemTime 的 serde 形态)。
            "joined_at": { "secs_since_epoch": 1_700_000_000_u64, "nanos_since_epoch": 0_u32 },
        }],
        "created_at": { "secs_since_epoch": 1_700_000_000_u64, "nanos_since_epoch": 0_u32 },
    });

    invoke_ok("reflect_upsert_team", json!({ "team": team }));
    let got = invoke_ok("reflect_get_team", json!({ "name": name }));
    assert_eq!(got["name"], name, "团队读回名称不符: {got}");

    let list = invoke_ok("reflect_list_teams", json!({}));
    assert!(
        list.as_array()
            .expect("团队列表应为数组")
            .iter()
            .any(|t| t["name"] == name),
        "团队未出现在列表里"
    );

    invoke_ok("reflect_delete_team", json!({ "name": name }));
}

// ============================================================================
// Squad
// ============================================================================

#[test]
fn squad_create_get_delete() {
    let _guard = common::state_lock();
    let name = format!("probe-squad-{}", tag());
    let spec = json!({
        "name": name,
        "description": "能力覆盖层 squad",
        "leaderActor": {
            "actorType": "agent",
            "actorId": format!("team-lead@{name}"),
            "kind": "lead",
        },
        "members": [],
        "createdAtMs": 1_700_000_000_u64,
    });
    invoke_ok("reflect_create_squad", json!({ "spec": spec }));

    let got = invoke_ok("reflect_get_squad", json!({ "name": name }));
    assert_eq!(got["name"], name, "squad 读回名称不符: {got}");

    let list = invoke_ok("reflect_list_squads", json!({}));
    assert!(list.is_array(), "squad 列表应为数组: {list}");

    invoke_ok("reflect_delete_squad", json!({ "name": name }));
}

// ============================================================================
// 定时任务(cron)
// ============================================================================

#[test]
fn schedule_crud_round_trip() {
    let _guard = common::state_lock();
    let name = format!("probe-cron-{}", tag());
    let created = invoke_ok(
        "reflect_add_schedule",
        json!({ "schedule": "0 9 * * *", "prompt": "standup", "name": name }),
    );
    let id = created["id"].as_str().expect("定时任务缺少 id").to_string();

    let list = invoke_ok("reflect_list_schedules", json!({}));
    assert!(
        list.as_array()
            .expect("定时任务列表应为数组")
            .iter()
            .any(|s| s["id"] == id),
        "定时任务未出现在列表里"
    );

    let updated = invoke_ok(
        "reflect_update_schedule",
        json!({ "id": id, "schedule": "30 8 * * *", "enabled": false }),
    );
    assert_eq!(
        updated["schedule"], "30 8 * * *",
        "cron 表达式未更新: {updated}"
    );

    let status = invoke_ok("reflect_get_schedule_status", json!({}));
    assert!(status.is_object(), "定时任务状态应为对象: {status}");

    let removed = invoke_ok("reflect_remove_schedule", json!({ "id": id }));
    assert_eq!(removed, true, "删除未返回 true");
}

// ============================================================================
// 插件
// ============================================================================

#[test]
fn plugin_listing_and_toggle() {
    let _guard = common::state_lock();
    let list = invoke_ok("reflect_list_plugins", json!({}));
    assert!(list.is_array(), "插件列表应为数组: {list}");
    assert!(invoke_ok("reflect_list_marketplaces", json!({})).is_array());
    assert!(invoke_ok("reflect_list_plugin_commands", json!({})).is_array());

    // 切一个不存在的插件 → 后端**幂等**:返回 Ok(null),不报错。
    // 这条守的是「不崩 + 不误伤」,不是「必须报错」。
    let v = invoke_ok(
        "reflect_toggle_plugin",
        json!({ "id": "no-such-plugin-xyz", "enabled": true }),
    );
    assert!(v.is_null() || v.is_object(), "切插件结果形态异常: {v}");
}

// ============================================================================
// 子代理 spec
// ============================================================================

#[test]
fn subagent_spec_crud() {
    let role = format!("probe-role-{}", tag());
    // spec 的 frontmatter 必须同时有 `role` 与 `name` —— 少一个都会被
    // 解析器拒(缺字段 → 结构化错误,不落盘)。
    let markdown =
        format!("---\nrole: {role}\nname: {role}\ndescription: 探针子代理\n---\n\n你是探针。\n");

    invoke_ok(
        "reflect_save_subagent_spec",
        json!({ "role": role, "markdown": markdown }),
    );
    let got = invoke_ok("reflect_get_subagent_spec", json!({ "role": role }));
    assert!(
        got.as_str().unwrap_or_default().contains("探针子代理"),
        "子代理 spec 读回内容不符: {got}"
    );

    let list = invoke_ok("reflect_list_subagent_specs", json!({}));
    assert!(list.is_array(), "子代理列表应为数组: {list}");

    invoke_ok("reflect_delete_subagent_spec", json!({ "role": role }));
    let after = invoke_ok("reflect_get_subagent_spec", json!({ "role": role }));
    assert!(after.is_null(), "删除后仍能读到 spec: {after}");
}

#[test]
fn subagent_spec_without_role_is_rejected() {
    // 缺 `role` 的 frontmatter → 结构化错误,且**不落盘**。
    let role = format!("probe-bad-{}", tag());
    let e = invoke_err(
        "reflect_save_subagent_spec",
        json!({ "role": role, "markdown": "---\nname: x\n---\n\n正文\n" }),
    );
    assert!(!e.is_null(), "错误响应不应为 null");
}

// ============================================================================
// MCP
// ============================================================================

#[test]
fn mcp_servers_upsert_list_delete() {
    let _guard = common::state_lock();
    let name = format!("probe-mcp-{}", tag());
    let entry = json!({
        "type": "stdio",
        "command": "echo",
        "args": ["probe"],
    });
    invoke_ok(
        "reflect_upsert_mcp_server",
        json!({ "name": name, "entry": entry }),
    );

    let list = invoke_ok("reflect_list_mcp_servers", json!({}));
    assert!(
        list.as_array()
            .expect("MCP 列表应为数组")
            .iter()
            .any(|s| s["name"] == name),
        "MCP server 未出现在列表里"
    );

    // 无 MCP server 时资源 / prompt 列表应为空数组(不是错误)。
    assert!(invoke_ok("reflect_list_mcp_resources", json!({})).is_array());
    assert!(invoke_ok("reflect_list_mcp_prompts", json!({})).is_array());
    assert!(invoke_ok("reflect_mcp_catalog", json!({})).is_array());

    invoke_ok("reflect_delete_mcp_server", json!({ "name": name }));
}

// ============================================================================
// LSP
// ============================================================================

#[test]
fn lsp_status_and_toggle() {
    let _guard = common::state_lock();
    let status = invoke_ok("reflect_lsp_status", json!({}));
    assert!(status.is_object(), "LSP 状态应为对象: {status}");
    // 关 → 开 → 关(默认是关的)。
    let enabled = invoke_ok("reflect_lsp_set_enabled", json!({ "enabled": true }));
    assert!(enabled.is_object(), "LSP 开关结果应为对象: {enabled}");
    let disabled = invoke_ok("reflect_lsp_set_enabled", json!({ "enabled": false }));
    assert!(disabled.is_object(), "LSP 开关结果应为对象: {disabled}");
    // 未开启时诊断查询应返回空数组而非报错。
    let diags = invoke_ok("reflect_lsp_diagnostics", json!({ "path": "main.rs" }));
    assert!(diags.is_array(), "LSP 诊断应为数组: {diags}");
}

#[test]
fn lsp_warmup_without_a_server_is_a_noop() {
    // 未启用 LSP → 预热返回 `warmed: false`,**不**拉起语言服务器。
    let v = invoke_ok("reflect_lsp_warmup", json!({ "path": "main.rs" }));
    assert!(v.is_object(), "预热结果应为对象: {v}");
    assert_eq!(v["warmed"], false, "未启用 LSP 时不应预热: {v}");
}

// ============================================================================
// 提示词层
// ============================================================================

#[test]
fn prompt_layers_are_readable() {
    let effective = invoke_ok("reflect_get_effective_prompt", json!({}));
    assert!(effective.is_object(), "生效提示词应为对象: {effective}");
    // list 动作走 Op 通道 —— 立即返回 submission id。
    let id = invoke_ok(
        "reflect_prompt_command",
        json!({ "action": { "type": "list" } }),
    );
    assert!(id.is_string(), "prompt 命令应返回 submission id: {id}");
}

// ============================================================================
// KMS 知识库
// ============================================================================

#[test]
fn kms_wiki_page_lifecycle() {
    let wiki = format!("probe-wiki-{}", tag());
    let created = invoke_ok(
        "reflect_kms_create",
        json!({ "name": wiki, "description": "能力覆盖层 wiki" }),
    );
    assert_eq!(created["name"], wiki, "wiki 名称不符: {created}");

    invoke_ok(
        "reflect_kms_save_page",
        json!({
            "wiki": wiki,
            "page": "index.md",
            "content": "# 标题\n\ncapability layer probe body\n",
            "title": "标题",
            "tags": ["probe"],
        }),
    );
    let page = invoke_ok(
        "reflect_kms_get_page",
        json!({ "wiki": wiki, "page": "index.md" }),
    );
    assert!(
        page.to_string().contains("capability layer probe body"),
        "页面正文读回不符: {page}"
    );

    let pages = invoke_ok("reflect_kms_list_pages", json!({ "wiki": wiki }));
    assert!(pages.is_array(), "页面列表应为数组: {pages}");

    let hits = invoke_ok("reflect_kms_search", json!({ "query": "capability" }));
    assert!(hits.is_array(), "知识库搜索应为数组: {hits}");

    let wikis = invoke_ok("reflect_kms_list", json!({}));
    assert!(wikis.is_array(), "wiki 列表应为数组: {wikis}");

    invoke_ok("reflect_kms_delete", json!({ "name": wiki }));
}

#[test]
fn dream_writes_insights_to_a_wiki() {
    let _guard = common::state_lock();
    // dream 是纯 KMS 文件操作(写一份「会话洞察」wiki),**不需要模型**。
    let v = invoke_ok(
        "reflect_dream",
        json!({ "insights": ["能力覆盖层洞察一", "洞察二"], "sessionsAnalyzed": 2 }),
    );
    assert!(v.is_object(), "dream 结果应为对象: {v}");

    // 落地了:生成的 wiki 能在列表里看到。
    let wikis = invoke_ok("reflect_kms_list", json!({}));
    assert!(
        wikis
            .as_array()
            .expect("wiki 列表应为数组")
            .iter()
            .any(|w| w["name"] == "dream-insights"),
        "dream 生成的 wiki 未出现在列表里"
    );
}

// ============================================================================
// Side-channel
// ============================================================================

#[test]
fn side_channel_start_list_cancel() {
    let started = invoke_ok(
        "reflect_start_side_channel",
        json!({ "agentName": "probe-helper", "prompt": "探针提示" }),
    );
    let id = started["id"]
        .as_str()
        .expect("side-channel 缺少 id")
        .to_string();

    let list = invoke_ok("reflect_list_side_channels", json!({}));
    assert!(
        list.as_array()
            .expect("side-channel 列表应为数组")
            .iter()
            .any(|s| s["id"] == id),
        "side-channel 未出现在列表里"
    );

    let got = invoke_ok("reflect_get_side_channel", json!({ "id": id.clone() }));
    assert_eq!(got["id"], id, "side-channel 读回 id 不符: {got}");

    let cancelled = invoke_ok("reflect_cancel_side_channel", json!({ "id": id }));
    assert!(cancelled.is_boolean(), "取消结果应为布尔: {cancelled}");
}

#[test]
fn squad_delegates_and_assigns_tasks() {
    let _guard = common::state_lock();
    let name = format!("probe-squad-{}", tag());
    let spec = json!({
        "name": name,
        "description": "能力覆盖层 squad 委派",
        "leaderActor": {
            "actorType": "agent",
            "actorId": format!("team-lead@{name}"),
            "kind": "lead",
        },
        "members": [],
        "createdAtMs": 1_700_000_000_u64,
    });
    invoke_ok("reflect_create_squad", json!({ "spec": spec }));

    // 委派需要一个**待办任务** —— 任务列表名与 squad 同名。
    let task = invoke_ok(
        "reflect_create_task",
        json!({ "list": name, "subject": "待委派任务", "description": "探针" }),
    );
    let task_id = task["id"].as_u64().expect("任务缺少数字 id");

    // 指派给具体成员。
    let assigned = invoke_ok(
        "reflect_assign_squad_task",
        json!({ "name": name, "taskId": task_id, "assignee": "builder@x" }),
    );
    assert_eq!(assigned["id"], task_id, "指派后任务 id 不符: {assigned}");

    // 委派下一个任务(无待办时返回 null)。
    let delegated = invoke_ok(
        "reflect_delegate_next",
        json!({ "name": name, "leaderActorId": format!("team-lead@{name}") }),
    );
    assert!(
        delegated.is_null() || delegated.is_object(),
        "委派结果形态异常: {delegated}"
    );

    invoke_ok("reflect_delete_squad", json!({ "name": name }));
}

// ============================================================================
// 远程模式 / tailscale
// ============================================================================

#[test]
fn remote_config_round_trips() {
    let _guard = common::state_lock();
    let before = invoke_ok("reflect_get_remote_config", json!({}));
    assert!(before.is_object(), "远程配置应为对象: {before}");

    let after = invoke_ok(
        "reflect_update_remote_config",
        json!({ "host": "127.0.0.1", "port": 8787, "autoConnect": false }),
    );
    assert_eq!(after["host"], "127.0.0.1", "远程 host 未更新: {after}");

    let status = invoke_ok("reflect_get_remote_status", json!({}));
    assert!(status.is_object(), "远程状态应为对象: {status}");
}

#[test]
fn tailscale_status_commands_are_readable() {
    // tailscale 二进制本机可能没装 —— 命令必须返回**结构化结果**,
    // 而不是 panic 或挂死。
    for cmd in [
        "reflect_tailscale_status",
        "reflect_tailscale_daemon_status",
        "reflect_tailscale_daemon_command_preview",
    ] {
        let v = invoke_ok(cmd, json!({}));
        assert!(!v.is_null(), "{cmd} 返回 null");
    }
}

// ============================================================================
// 插件装卸 —— 只走**失败路径**(不真的装卸任何东西)
// ============================================================================

#[test]
fn plugin_install_and_uninstall_reject_bad_input() {
    let _guard = common::state_lock();
    // 非法 marketplace 名 → 结构化错误,装卸**一步都不执行**。
    let e = invoke_err(
        "reflect_install_plugin",
        json!({ "path": "/nonexistent/plugin", "marketplace": "BAD NAME", "scope": "user" }),
    );
    assert!(!e.is_null(), "错误响应不应为 null");

    // 非法 plugin id → 解析阶段就失败,不会碰到插件目录。
    let e = invoke_err(
        "reflect_uninstall_plugin",
        json!({ "id": "not a valid plugin id", "scope": "user" }),
    );
    assert!(!e.is_null(), "错误响应不应为 null");
}

// ============================================================================
// 讨论 / 流水线 —— 只走**失败路径**(不真的起编排)
// ============================================================================

#[test]
fn pipeline_and_discussion_runs_reject_missing_inputs() {
    let _guard = common::state_lock();
    // 配置文件不存在 → 结构化错误,**不会**起任何 agent 编排。
    let e = invoke_err(
        "reflect_run_pipeline",
        json!({ "configPath": "/nonexistent/pipeline.toml", "topic": "探针" }),
    );
    assert!(!e.is_null(), "错误响应不应为 null");

    let e = invoke_err(
        "reflect_run_discussion",
        json!({ "configPath": "/nonexistent/discussion.toml" }),
    );
    assert!(!e.is_null(), "错误响应不应为 null");

    // 团队不存在 → 结构化错误。
    let e = invoke_err(
        "reflect_run_team_pipeline",
        json!({ "teamName": "no-such-team-xyz", "topic": "探针" }),
    );
    assert!(!e.is_null(), "错误响应不应为 null");
}

// ============================================================================
// 讨论 / 流水线
// ============================================================================

#[test]
fn discussion_listing_is_readable() {
    let list = invoke_ok("reflect_list_discussions", json!({}));
    assert!(list.is_array(), "讨论列表应为数组: {list}");
}

#[test]
fn pipeline_config_save_and_validate() {
    let _guard = common::state_lock();
    let name = format!("probe-pipeline-{}", tag());
    let toml = "name = \"probe\"\n";
    let saved = invoke_ok(
        "reflect_save_pipeline_config",
        json!({ "name": name, "tomlSrc": toml }),
    );
    assert_eq!(saved["name"], name, "流水线配置名不符: {saved}");

    let list = invoke_ok("reflect_list_pipeline_configs", json!({}));
    assert!(list.is_array(), "流水线配置列表应为数组: {list}");

    // 非法 TOML → 结构化错误,不得 panic。
    let e = invoke_err(
        "reflect_validate_pipeline",
        json!({ "tomlSrc": "=== not toml ===" }),
    );
    assert!(!e.is_null(), "错误响应不应为 null");
}

// ============================================================================
// 模型费率 / 配额 —— 网络类,只断言结构化结果
// ============================================================================

#[test]
fn network_bound_commands_return_structured_results() {
    for (cmd, body) in [
        (
            "reflect_list_provider_models",
            json!({ "baseUrl": "http://127.0.0.1:9/v1", "apiKey": "probe", "endpoint": "models" }),
        ),
        (
            "reflect_test_provider_chat",
            json!({
                "baseUrl": "http://127.0.0.1:9/v1",
                "apiKey": "probe",
                "endpoint": "chat/completions",
                "model": "probe-model",
            }),
        ),
        (
            "reflect_query_plan_quota",
            json!({ "baseUrl": "http://127.0.0.1:9", "apiKey": "probe", "checkVia": "header" }),
        ),
    ] {
        match invoke(cmd, body) {
            Ok(v) => assert!(!v.is_null(), "{cmd} 返回 null"),
            Err(e) => assert!(!e.is_null(), "{cmd} 错误响应不应为 null"),
        }
    }
}
