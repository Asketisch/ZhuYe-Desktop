//! 命令注册表 —— 生产 `run()` 与**能力覆盖层**测试共用的唯一装配入口。
//!
//! 本文件只承载命令面:`use crate::commands::{…}` 全量导入 +
//! `configure()` 的 `invoke_handler!` 注册表 + 插件/托管状态/窗口事件
//! 钩子。lib.rs 经
//! `pub use commands_registry::configure` 透出,命令面**只增一次**的契约
//! 不变(见根 AGENTS.md「架构红线」与原 lib.rs 配置函数文档)。
//!
//! ## 底座由调用方给
//!
//! builder 本体由调用方提供:
//! - 生产:`tauri::Builder::<tauri::Wry>::new()`;
//! - 测试:`tauri::test::mock_builder()` —— invoke key 必须匹配,测试
//!   夹具必须用 `mock_builder()` 作底座。
//!
//! ## 边界
//!
//! - 应用菜单与 `on_menu_event` 留在生产 `run()`:菜单走 muda 原生层,
//!   mock runtime 不需要应用菜单。
//! - `setup` 钩子(托盘 / 全局快捷键 / dock 徽标)是 OS 级副作用,
//!   留在 `run()`。

// crate 根 glob:tauri `#[tauri::command]` 的 `__cmd__*` 宏经 #[macro_export]
// 落在 crate 根,generate_handler! 展开时要在作用域内能解析到它们。
use crate::commands::{
    ping, zhuye_activity_count, zhuye_add_memory, zhuye_add_permission_rule,
    zhuye_add_schedule, zhuye_agent_status, zhuye_all_model_usage, zhuye_archive_session,
    zhuye_ask_user_input_response, zhuye_ask_user_question_response, zhuye_assign_squad_task,
    zhuye_autopilot_history, zhuye_bind_session, zhuye_browse_marketplace,
    zhuye_browser_back, zhuye_browser_env, zhuye_browser_forward, zhuye_browser_navigate,
    zhuye_browser_reload, zhuye_browser_set_device, zhuye_browser_start,
    zhuye_browser_status, zhuye_browser_stop, zhuye_cancel_discussions,
    zhuye_cancel_side_channel, zhuye_check_allowlist, zhuye_check_update, zhuye_claim_task,
    zhuye_clear_activity, zhuye_compact, zhuye_computer_use, zhuye_config_info,
    zhuye_create_session, zhuye_create_squad, zhuye_create_task,
    zhuye_credential_pool_status, zhuye_current_workspace, zhuye_current_workspace_dirs,
    zhuye_cycle_permission_mode, zhuye_delegate_next, zhuye_delete_agent_def,
    zhuye_delete_mcp_server, zhuye_delete_session, zhuye_delete_squad,
    zhuye_delete_subagent_spec, zhuye_delete_task, zhuye_delete_team,
    zhuye_download_install_update, zhuye_dream, zhuye_effort_capability,
    zhuye_enter_goal_mode, zhuye_enter_plan_mode, zhuye_exit_goal_mode,
    zhuye_exit_plan_mode, zhuye_export_session, zhuye_export_session_markdown,
    zhuye_fork_session, zhuye_generate_session_title, zhuye_get_active_agent,
    zhuye_get_agent_def, zhuye_get_autopilot_config, zhuye_get_config,
    zhuye_get_effective_prompt, zhuye_get_effort, zhuye_get_remote_config,
    zhuye_get_remote_status, zhuye_get_schedule_status, zhuye_get_side_channel,
    zhuye_get_squad, zhuye_get_subagent_spec, zhuye_get_task, zhuye_get_task_output,
    zhuye_get_team, zhuye_get_trace, zhuye_gh_pr_list, zhuye_git_commit, zhuye_git_diff,
    zhuye_git_log, zhuye_git_stage, zhuye_git_status, zhuye_git_unstage,
    zhuye_goal_snapshot, zhuye_hook_approval, zhuye_image_process, zhuye_import_discover,
    zhuye_import_sessions, zhuye_ingest_upload, zhuye_install_from_marketplace,
    zhuye_install_plugin, zhuye_install_skill, zhuye_install_skill_from_market,
    zhuye_interrupt, zhuye_kill_shell, zhuye_kms_create, zhuye_kms_delete,
    zhuye_kms_get_page, zhuye_kms_list, zhuye_kms_list_pages, zhuye_kms_save_page,
    zhuye_kms_search, zhuye_list_activity, zhuye_list_agent_defs,
    zhuye_list_archived_sessions, zhuye_list_dir, zhuye_list_discussions,
    zhuye_list_hook_events, zhuye_list_hooks, zhuye_list_marketplaces,
    zhuye_list_mcp_prompts, zhuye_list_mcp_resources, zhuye_list_mcp_servers,
    zhuye_list_media, zhuye_list_memory, zhuye_list_note_sessions,
    zhuye_list_permission_rules, zhuye_list_pipeline_configs, zhuye_list_plugin_commands,
    zhuye_list_plugins, zhuye_list_provider_models, zhuye_list_schedules,
    zhuye_list_session_notes, zhuye_list_sessions, zhuye_list_shell_sessions,
    zhuye_list_side_channels, zhuye_list_skills, zhuye_list_span_logs, zhuye_list_squads,
    zhuye_list_subagent_specs, zhuye_list_tasks, zhuye_list_teams, zhuye_list_tools,
    zhuye_list_traces, zhuye_list_workspaces, zhuye_list_worktrees, zhuye_load_allowlist, zhuye_create_worktree, zhuye_remove_worktree, zhuye_prune_worktrees,
    zhuye_lookup_model_abilities, zhuye_lsp_diagnostics, zhuye_lsp_set_enabled,
    zhuye_lsp_status, zhuye_lsp_warmup, zhuye_mcp_catalog, zhuye_media_capabilities,
    zhuye_memory_sections, zhuye_model_rate_cards, zhuye_parse_agent_md, zhuye_pick_file,
    zhuye_pick_files, zhuye_pick_workspace_folder, zhuye_plan_approval,
    zhuye_prompt_command, zhuye_pty_close, zhuye_pty_resize, zhuye_pty_start,
    zhuye_pty_write, zhuye_query_guard_stats, zhuye_query_plan_quota,
    zhuye_query_subagents, zhuye_read_file, zhuye_read_image_base64, zhuye_read_span_log,
    zhuye_recovery_state, zhuye_refresh_skill_market_index, zhuye_relaunch_app,
    zhuye_release_task, zhuye_remote_bind, zhuye_remote_bootstrap, zhuye_remote_connect,
    zhuye_remote_disconnect, zhuye_remote_host_remove, zhuye_remote_host_save,
    zhuye_remote_hosts, zhuye_remote_sessions, zhuye_remote_test, zhuye_remove_memory,
    zhuye_remove_schedule, zhuye_remove_workspace, zhuye_rename_session,
    zhuye_replay_session, zhuye_rescan_extensions, zhuye_reveal_path, zhuye_rewind,
    zhuye_run_discussion, zhuye_run_pipeline, zhuye_run_security_scan, zhuye_run_shell,
    zhuye_run_team_pipeline, zhuye_sandbox_status, zhuye_save_agent_def,
    zhuye_save_allowlist, zhuye_save_config, zhuye_save_pipeline_config,
    zhuye_save_subagent_spec, zhuye_scan_local_ports, zhuye_screenshot,
    zhuye_search_activity, zhuye_search_files, zhuye_search_sessions,
    zhuye_search_skill_market, zhuye_session_stats, zhuye_set_active_agent,
    zhuye_set_dock_badge, zhuye_set_effort, zhuye_set_model, zhuye_set_permission_mode,
    zhuye_set_workspace, zhuye_set_workspace_dirs, zhuye_shutdown,
    zhuye_start_side_channel, zhuye_status_server_start, zhuye_status_server_state,
    zhuye_status_server_stop, zhuye_steer, zhuye_stop_task, zhuye_submit,
    zhuye_tailscale_daemon_command_preview, zhuye_tailscale_daemon_start,
    zhuye_tailscale_daemon_status, zhuye_tailscale_daemon_stop, zhuye_tailscale_status,
    zhuye_test_provider_chat, zhuye_toggle_hook, zhuye_toggle_plugin, zhuye_tool_approval,
    zhuye_unarchive_session, zhuye_uninstall_plugin, zhuye_update_autopilot_config,
    zhuye_update_remote_config, zhuye_update_schedule, zhuye_update_task,
    zhuye_upsert_mcp_server, zhuye_upsert_team, zhuye_validate_pipeline, zhuye_write_file,
};
use crate::*;

use crate::state::MinimalAgent;

/// 应用构建器 —— 生产运行与**能力覆盖层**测试共用同一份命令注册表。
///
/// ## 为什么要抽出来
///
/// 能力覆盖层(`src-tauri/tests/`)必须在**真实**的 `generate_handler!`
/// 注册表上驱动真实命令体。如果测试自己维护一份命令清单,两份清单迟早
/// 分叉 —— 「命令已接线」就成了自说自话。这里把注册表收敛到唯一入口:
/// 生产 `run()` 与测试夹具都从这里装配,命令面**只增一次**。
///
/// ## 底座由调用方给
///
/// 本函数只装**命令面 + 托管状态 + 插件 + 窗口事件钩子**;builder 本体
/// 由调用方提供:
/// - 生产:`tauri::Builder::<tauri::Wry>::new()`;
/// - 测试:`tauri::test::mock_builder()` —— 它负责 mock runtime 的
///   invoke key 与初始化脚本。**invoke key 必须匹配**:`Webview::on_message`
///   校验 key,不匹配时命令**静默不执行**、调用方一直阻塞,所以测试夹具
///   必须用 `mock_builder()` 作底座,不能自己 `Builder::new()`。
///
/// ## 边界
///
/// - 应用菜单(`.menu`)与 `on_menu_event` **不**在共享装配里:菜单走
///   muda 原生层,只有真实 Wry runtime 才能建;测试夹具用 mock runtime,
///   不需要应用菜单。`enable_macos_default_menu(false)` 保证 mock 构建
///   阶段不会隐式创建 NSMenu。
/// - `setup` 钩子(托盘 / 全局快捷键 / dock 徽标)同样留在 `run()`:这些是
///   OS 级副作用,只在真实事件循环里跑一次。
pub fn configure<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        // ====== Plugins ======
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        // ====== 状态 ======
        .manage(MinimalAgent::new_empty())
        .enable_macos_default_menu(false)
        // ====== IPC commands ======
        .invoke_handler(tauri::generate_handler![
            ping,
            zhuye_submit,
            zhuye_interrupt,
            zhuye_compact,
            zhuye_rewind,
            zhuye_shutdown,
            zhuye_tool_approval,
            zhuye_hook_approval,
            zhuye_enter_plan_mode,
            zhuye_exit_plan_mode,
            zhuye_enter_goal_mode,
            zhuye_exit_goal_mode,
            zhuye_goal_snapshot,
            zhuye_plan_approval,
            zhuye_effort_capability,
            zhuye_set_effort,
            zhuye_get_effort,
            zhuye_ask_user_question_response,
            zhuye_ask_user_input_response,
            zhuye_set_permission_mode,
            zhuye_cycle_permission_mode,
            zhuye_steer,
            zhuye_query_subagents,
            zhuye_create_session,
            // 受控浏览器面板(启动/停止/状态/导航/设备模拟/诊断;帧流走
            // zhuye_browser_frame 事件;导航走短连接 page 级 CDP 命令)
            zhuye_browser_start,
            zhuye_browser_stop,
            zhuye_browser_status,
            zhuye_browser_navigate,
            zhuye_browser_back,
            zhuye_browser_forward,
            zhuye_browser_reload,
            zhuye_browser_set_device,
            zhuye_browser_env,
            zhuye_bind_session,
            zhuye_list_sessions,
            zhuye_rename_session,
            zhuye_fork_session,
            zhuye_generate_session_title,
            zhuye_delete_session,
            zhuye_archive_session,
            zhuye_unarchive_session,
            zhuye_list_archived_sessions,
            zhuye_replay_session,
            zhuye_search_sessions,
            zhuye_export_session,
            // 诊断 / config / tools
            zhuye_agent_status,
            zhuye_get_config,
            zhuye_save_config,
            zhuye_set_model,
            zhuye_query_plan_quota,
            zhuye_list_provider_models,
            zhuye_lookup_model_abilities,
            zhuye_lsp_set_enabled,
            zhuye_lsp_status,
            zhuye_lsp_warmup,
            zhuye_lsp_diagnostics,
            zhuye_test_provider_chat,
            zhuye_list_tools,
            // 各领域 domain 管理(workspace / skills / memory / hooks / git)
            zhuye_list_workspaces,
            zhuye_pty_start,
            zhuye_pty_write,
            zhuye_pty_resize,
            zhuye_pty_close,
            zhuye_remove_workspace,
            zhuye_current_workspace_dirs,
            zhuye_set_workspace,
            zhuye_set_workspace_dirs,
            zhuye_pick_workspace_folder,
            zhuye_pick_file,
            zhuye_pick_files,
            zhuye_reveal_path,
            zhuye_current_workspace,
            zhuye_install_skill,
            zhuye_install_skill_from_market,
            zhuye_list_skills,
            zhuye_rescan_extensions,
            zhuye_query_guard_stats,
            zhuye_search_skill_market,
            zhuye_refresh_skill_market_index,
            zhuye_scan_local_ports,
            zhuye_list_plugin_commands,
            // 插件管理(列表 / 启停 / 卸载 / 本地安装 / 市场浏览与安装)
            zhuye_list_plugins,
            zhuye_list_marketplaces,
            zhuye_toggle_plugin,
            zhuye_uninstall_plugin,
            zhuye_browse_marketplace,
            zhuye_import_discover,
            zhuye_import_sessions,
            zhuye_install_from_marketplace,
            zhuye_install_plugin,
            zhuye_list_memory,
            zhuye_add_memory,
            zhuye_remove_memory,
            zhuye_list_hooks,
            zhuye_list_hook_events,
            zhuye_list_hook_events,
            zhuye_toggle_hook,
            zhuye_git_status,
            zhuye_list_worktrees,
            zhuye_create_worktree,
            zhuye_remove_worktree,
            zhuye_prune_worktrees,
            zhuye_git_stage,
            zhuye_git_unstage,
            zhuye_git_commit,
            zhuye_gh_pr_list,
            zhuye_git_diff,
            zhuye_git_log,
            // 终端 shell exec + streaming
            zhuye_run_shell,
            zhuye_kill_shell,
            zhuye_list_shell_sessions,
            // 文件树 + read_file
            zhuye_list_dir,
            zhuye_read_file,
            zhuye_read_image_base64,
            zhuye_ingest_upload,
            zhuye_write_file,
            // 审批白名单 / Markdown 导出 / 更新检查 / 文件搜索
            zhuye_load_allowlist,
            zhuye_save_allowlist,
            zhuye_check_allowlist,
            zhuye_export_session_markdown,
            zhuye_check_update,
            // 自更新（OTA）：下载安装 + 重启生效
            zhuye_download_install_update,
            zhuye_relaunch_app,
            zhuye_search_files,
            // Task/Team 管理命令(多 agent 协调,包装 zhuye_task::TaskManager)
            zhuye_list_tasks,
            zhuye_create_task,
            zhuye_get_task,
            zhuye_get_task_output,
            zhuye_stop_task,
            zhuye_release_task,
            zhuye_update_task,
            zhuye_claim_task,
            zhuye_delete_task,
            zhuye_list_teams,
            zhuye_upsert_team,
            zhuye_get_team,
            zhuye_delete_team,
            // Schedule(cron)管理命令(包装 zhuye_stream::cron::CronScheduler)
            zhuye_list_schedules,
            zhuye_add_schedule,
            zhuye_update_schedule,
            zhuye_remove_schedule,
            zhuye_get_schedule_status,
            // Agent definition 管理命令(包装 zhuye_agent_def)
            zhuye_list_agent_defs,
            zhuye_get_agent_def,
            zhuye_save_agent_def,
            zhuye_delete_agent_def,
            zhuye_parse_agent_md,
            // Side-channel(用户驱动的并发 agent)
            zhuye_start_side_channel,
            zhuye_cancel_side_channel,
            zhuye_list_side_channels,
            zhuye_get_side_channel,
            // SSH 远程开发(host 注册表 + serve 传输 + 会话路由)
            zhuye_remote_hosts,
            zhuye_remote_host_save,
            zhuye_remote_host_remove,
            zhuye_remote_test,
            zhuye_remote_bootstrap,
            zhuye_remote_connect,
            zhuye_remote_bind,
            zhuye_remote_disconnect,
            zhuye_remote_sessions,
            // 远程模式（iOS 远端 daemon）
            zhuye_get_remote_config,
            zhuye_update_remote_config,
            zhuye_get_remote_status,
            zhuye_tailscale_status,
            zhuye_tailscale_daemon_command_preview,
            zhuye_tailscale_daemon_start,
            zhuye_tailscale_daemon_stop,
            zhuye_status_server_start,
            zhuye_status_server_state,
            zhuye_status_server_stop,
            zhuye_tailscale_daemon_status,
            // KMS（基于 grep 的 wiki + /dream）
            zhuye_kms_list,
            zhuye_kms_create,
            zhuye_kms_delete,
            zhuye_kms_save_page,
            zhuye_kms_get_page,
            zhuye_kms_list_pages,
            zhuye_kms_search,
            zhuye_dream,
            // Autopilot(自动任务调度)
            zhuye_get_autopilot_config,
            zhuye_update_autopilot_config,
            zhuye_autopilot_history,
            // Activity timeline(本地事件审计日志)
            zhuye_list_activity,
            zhuye_search_activity,
            zhuye_clear_activity,
            zhuye_activity_count,
            // Squad + Leader delegation
            zhuye_list_squads,
            zhuye_create_squad,
            zhuye_get_squad,
            zhuye_delete_squad,
            zhuye_delegate_next,
            zhuye_assign_squad_task,
            // 媒体工作室 + 电脑操控（仅元数据的后端）
            zhuye_list_media,
            zhuye_image_process,
            zhuye_screenshot,
            zhuye_computer_use,
            zhuye_media_capabilities,
            zhuye_set_dock_badge,
            // Traces —— 本地 LLM 调用记录只读查询(CLI `zhuye traces` 的 GUI 对应)
            zhuye_list_traces,
            // 运行时状态只读面(凭证池健康度 / 已完成子代理调用 / 记忆分段 / 配置位置)
            zhuye_credential_pool_status,
            zhuye_recovery_state,
            zhuye_memory_sections,
            zhuye_config_info,
            // MCP 服务管理(增删 + 精选 catalog)—— 扩展机制的自助入口
            zhuye_list_mcp_servers,
            zhuye_mcp_catalog,
            zhuye_upsert_mcp_server,
            zhuye_delete_mcp_server,
            zhuye_list_mcp_resources,
            zhuye_list_mcp_prompts,
            // 子代理 spec(`call_<role>` 工具的来源)—— 此前无任何编辑面
            zhuye_list_subagent_specs,
            zhuye_get_subagent_spec,
            zhuye_save_subagent_spec,
            zhuye_delete_subagent_spec,
            zhuye_get_trace,
            // Span 日志(turn → model → tool 父子链 + goal 事件)
            zhuye_list_span_logs,
            zhuye_read_span_log,
            // 多 agent 讨论(CLI `zhuye discussion` 的 GUI 对应;Collab* 事件
            // 经 session broadcast 实时推送,前端 collab_* reducer 既有渲染)
            zhuye_list_discussions,
            zhuye_run_discussion,
            zhuye_cancel_discussions,
            // DAG 流水线(CLI `zhuye pipeline` 的 GUI 对应;team 四阶段预设 + TOML DAG)
            zhuye_run_team_pipeline,
            // 安全扫描(cargo audit)—— 核心真实实现,GUI 此前只能开终端跑
            zhuye_run_security_scan,
            // Pipeline 配置编辑(实时校验 + 落盘)—— 此前只能跑手写文件
            zhuye_validate_pipeline,
            zhuye_list_pipeline_configs,
            zhuye_save_pipeline_config,
            zhuye_run_pipeline,
            // 会话统计(模型级 token 用量 / 压缩节省 / 记忆访问)—— 只读扫描 rollout JSONL
            zhuye_session_stats,
            zhuye_all_model_usage,
            // 模型费率卡(核心静态费率表反解)—— 让费用在 GUI 里可解释
            zhuye_model_rate_cards,
            // 权限规则:只读查询(核心三层 store 的生效规则)+ 追加用户级 allow 规则
            // (审批弹窗的「始终允许这条命令」—— 落进核心的 permissions.toml,立即生效)
            zhuye_list_permission_rules,
            zhuye_add_permission_rule,
            // 会话笔记只读查询(agent 写下的持久笔记)—— 让 agent 记的东西可见
            zhuye_list_session_notes,
            zhuye_list_note_sessions,
            // 活跃 agent(决定加载哪条 agent 定义 + 记忆目录)
            zhuye_get_active_agent,
            zhuye_set_active_agent,
            // OS 沙箱有效状态(Seatbelt / Landlock 是否真的生效)
            zhuye_sandbox_status,
            // 当前模型实际生效的提示词正文(按模型匹配后解析的结果)
            zhuye_get_effective_prompt,
            // 提示词层管理(`/prompt` slash)—— Op 递进引擎,应答走 zhuye_event 通道
            zhuye_prompt_command,
        ])
        // ====== Window 事件:macOS close-to-tray ======
        .on_window_event(|window, event| {
            menu::handle_close_to_tray(window, event);
        })
}
