//! `reflect-desktop` Tauri 2 后端库。
//!
//! ## 里程碑
//!
//! - **M1.x** (已): 协议桥 —— 19 个 Tauri command + Event 转发到前端,MinimalAgent stub。
//! - **M2.x** (当前): 真后端 —— MinimalAgent 改为嵌入 `reflect_core::AgentThread`
//!   (stub model + EchoTool,不依赖网络);4 个产品联动 (tray / menu / shortcut / dock) 实装;
//!   macOS close-to-tray。
//!
//! 蓝图:Reflect-Agent `docs/gui/03-architecture.md` §5 (M1.x 设计沉淀)。

mod agent_state;
pub mod commands;
pub mod dock;
pub mod events;
mod hook_store;
pub mod mcp;
mod media_backend;
mod memory_store;
pub mod menu;
mod shell_sessions;
pub mod shortcut;
pub mod state;
pub mod tray;
mod workspace_state;

use commands::{
    ping, reflect_activity_count, reflect_add_memory, reflect_add_permission_rule,
    reflect_add_schedule, reflect_agent_status, reflect_all_model_usage, reflect_archive_session,
    reflect_ask_user_input_response, reflect_ask_user_question_response, reflect_assign_squad_task,
    reflect_autopilot_history, reflect_bind_session, reflect_cancel_side_channel,
    reflect_check_allowlist, reflect_check_update, reflect_claim_task, reflect_clear_activity,
    reflect_compact, reflect_computer_use, reflect_config_info, reflect_create_session,
    reflect_create_squad, reflect_create_task, reflect_credential_pool_status,
    reflect_current_workspace, reflect_cycle_permission_mode, reflect_delegate_next,
    reflect_delete_agent_def, reflect_delete_mcp_server, reflect_delete_session,
    reflect_delete_squad, reflect_delete_subagent_spec, reflect_delete_task, reflect_delete_team,
    reflect_dream, reflect_enter_goal_mode, reflect_enter_plan_mode, reflect_exit_goal_mode,
    reflect_exit_plan_mode, reflect_export_session, reflect_export_session_markdown,
    reflect_fork_session, reflect_generate_session_title, reflect_get_active_agent,
    reflect_get_agent_def, reflect_get_autopilot_config, reflect_get_config,
    reflect_get_effective_prompt, reflect_get_effort, reflect_get_remote_config,
    reflect_get_remote_status, reflect_get_schedule_status, reflect_get_side_channel,
    reflect_get_squad, reflect_get_subagent_spec, reflect_get_task, reflect_get_task_output,
    reflect_get_team, reflect_get_trace, reflect_gh_pr_list, reflect_git_commit, reflect_git_diff,
    reflect_git_log, reflect_git_stage, reflect_git_status, reflect_git_unstage,
    reflect_hook_approval, reflect_image_process, reflect_install_plugin, reflect_interrupt,
    reflect_kill_shell, reflect_kms_create, reflect_kms_delete, reflect_kms_get_page,
    reflect_kms_list, reflect_kms_list_pages, reflect_kms_save_page, reflect_kms_search,
    reflect_list_activity, reflect_list_agent_defs, reflect_list_archived_sessions,
    reflect_list_dir, reflect_list_discussions, reflect_list_hook_events, reflect_list_hooks,
    reflect_list_marketplaces, reflect_list_mcp_prompts, reflect_list_mcp_resources,
    reflect_list_mcp_servers, reflect_list_media, reflect_list_memory, reflect_list_note_sessions,
    reflect_list_permission_rules, reflect_list_pipeline_configs, reflect_list_plugin_commands,
    reflect_list_plugins, reflect_list_provider_models, reflect_list_schedules,
    reflect_list_session_notes, reflect_list_sessions, reflect_list_shell_sessions,
    reflect_list_side_channels, reflect_list_skills, reflect_list_span_logs, reflect_list_squads,
    reflect_list_subagent_specs, reflect_list_tasks, reflect_list_teams, reflect_list_tools,
    reflect_list_traces, reflect_list_workspaces, reflect_list_worktrees, reflect_load_allowlist,
    reflect_lsp_diagnostics, reflect_lsp_set_enabled, reflect_lsp_status, reflect_lsp_warmup,
    reflect_mcp_catalog, reflect_media_capabilities, reflect_memory_sections,
    reflect_model_rate_cards, reflect_parse_agent_md, reflect_pick_file,
    reflect_pick_workspace_folder, reflect_plan_approval, reflect_prompt_command,
    reflect_query_plan_quota, reflect_query_subagents, reflect_read_file,
    reflect_read_image_base64, reflect_read_span_log, reflect_recovery_state, reflect_release_task,
    reflect_remove_memory, reflect_remove_schedule, reflect_rename_session, reflect_replay_session,
    reflect_reveal_path, reflect_rewind, reflect_run_discussion, reflect_run_pipeline,
    reflect_run_security_scan, reflect_run_shell, reflect_run_team_pipeline,
    reflect_sandbox_status, reflect_save_agent_def, reflect_save_allowlist, reflect_save_config,
    reflect_save_pipeline_config, reflect_save_subagent_spec, reflect_screenshot,
    reflect_search_activity, reflect_search_files, reflect_search_sessions, reflect_session_stats,
    reflect_set_active_agent, reflect_set_dock_badge, reflect_set_effort, reflect_set_model,
    reflect_set_permission_mode, reflect_set_workspace, reflect_shutdown,
    reflect_start_side_channel, reflect_steer, reflect_stop_task, reflect_submit,
    reflect_tailscale_daemon_command_preview, reflect_tailscale_daemon_start,
    reflect_tailscale_daemon_status, reflect_tailscale_daemon_stop, reflect_tailscale_status,
    reflect_test_provider_chat, reflect_toggle_hook, reflect_toggle_plugin, reflect_tool_approval,
    reflect_unarchive_session, reflect_uninstall_plugin, reflect_update_autopilot_config,
    reflect_update_remote_config, reflect_update_schedule, reflect_update_task,
    reflect_upsert_mcp_server, reflect_upsert_team, reflect_validate_pipeline, reflect_write_file,
};
use state::MinimalAgent;
use tauri::Manager;

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
            reflect_submit,
            reflect_interrupt,
            reflect_compact,
            reflect_rewind,
            reflect_shutdown,
            reflect_tool_approval,
            reflect_hook_approval,
            reflect_enter_plan_mode,
            reflect_exit_plan_mode,
            reflect_enter_goal_mode,
            reflect_exit_goal_mode,
            reflect_plan_approval,
            reflect_set_effort,
            reflect_get_effort,
            reflect_ask_user_question_response,
            reflect_ask_user_input_response,
            reflect_set_permission_mode,
            reflect_cycle_permission_mode,
            reflect_steer,
            reflect_query_subagents,
            reflect_create_session,
            reflect_bind_session,
            reflect_list_sessions,
            reflect_rename_session,
            reflect_fork_session,
            reflect_generate_session_title,
            reflect_delete_session,
            reflect_archive_session,
            reflect_unarchive_session,
            reflect_list_archived_sessions,
            reflect_replay_session,
            reflect_search_sessions,
            reflect_export_session,
            // 诊断 / config / tools
            reflect_agent_status,
            reflect_get_config,
            reflect_save_config,
            reflect_set_model,
            reflect_query_plan_quota,
            reflect_list_provider_models,
            reflect_lsp_set_enabled,
            reflect_lsp_status,
            reflect_lsp_warmup,
            reflect_lsp_diagnostics,
            reflect_test_provider_chat,
            reflect_list_tools,
            // 各领域 domain 管理(workspace / skills / memory / hooks / git)
            reflect_list_workspaces,
            reflect_set_workspace,
            reflect_pick_workspace_folder,
            reflect_pick_file,
            reflect_reveal_path,
            reflect_current_workspace,
            reflect_list_skills,
            reflect_list_plugin_commands,
            // 插件管理(列表 / 启停 / 卸载 / 本地安装)
            reflect_list_plugins,
            reflect_list_marketplaces,
            reflect_toggle_plugin,
            reflect_uninstall_plugin,
            reflect_install_plugin,
            reflect_list_memory,
            reflect_add_memory,
            reflect_remove_memory,
            reflect_list_hooks,
            reflect_list_hook_events,
            reflect_list_hook_events,
            reflect_toggle_hook,
            reflect_git_status,
            reflect_list_worktrees,
            reflect_git_stage,
            reflect_git_unstage,
            reflect_git_commit,
            reflect_gh_pr_list,
            reflect_git_diff,
            reflect_git_log,
            // 终端 shell exec + streaming
            reflect_run_shell,
            reflect_kill_shell,
            reflect_list_shell_sessions,
            // 文件树 + read_file
            reflect_list_dir,
            reflect_read_file,
            reflect_read_image_base64,
            reflect_write_file,
            // 审批白名单 / Markdown 导出 / 更新检查 / 文件搜索
            reflect_load_allowlist,
            reflect_save_allowlist,
            reflect_check_allowlist,
            reflect_export_session_markdown,
            reflect_check_update,
            reflect_search_files,
            // Task/Team 管理命令(多 agent 协调,包装 reflect_task::TaskManager)
            reflect_list_tasks,
            reflect_create_task,
            reflect_get_task,
            reflect_get_task_output,
            reflect_stop_task,
            reflect_release_task,
            reflect_update_task,
            reflect_claim_task,
            reflect_delete_task,
            reflect_list_teams,
            reflect_upsert_team,
            reflect_get_team,
            reflect_delete_team,
            // Schedule(cron)管理命令(包装 reflect_stream::cron::CronScheduler)
            reflect_list_schedules,
            reflect_add_schedule,
            reflect_update_schedule,
            reflect_remove_schedule,
            reflect_get_schedule_status,
            // Agent definition 管理命令(包装 reflect_agent_def)
            reflect_list_agent_defs,
            reflect_get_agent_def,
            reflect_save_agent_def,
            reflect_delete_agent_def,
            reflect_parse_agent_md,
            // Side-channel(用户驱动的并发 agent)
            reflect_start_side_channel,
            reflect_cancel_side_channel,
            reflect_list_side_channels,
            reflect_get_side_channel,
            // 远程模式（iOS 远端 daemon）
            reflect_get_remote_config,
            reflect_update_remote_config,
            reflect_get_remote_status,
            reflect_tailscale_status,
            reflect_tailscale_daemon_command_preview,
            reflect_tailscale_daemon_start,
            reflect_tailscale_daemon_stop,
            reflect_tailscale_daemon_status,
            // KMS（基于 grep 的 wiki + /dream）
            reflect_kms_list,
            reflect_kms_create,
            reflect_kms_delete,
            reflect_kms_save_page,
            reflect_kms_get_page,
            reflect_kms_list_pages,
            reflect_kms_search,
            reflect_dream,
            // Autopilot(自动任务调度)
            reflect_get_autopilot_config,
            reflect_update_autopilot_config,
            reflect_autopilot_history,
            // Activity timeline(本地事件审计日志)
            reflect_list_activity,
            reflect_search_activity,
            reflect_clear_activity,
            reflect_activity_count,
            // Squad + Leader delegation
            reflect_list_squads,
            reflect_create_squad,
            reflect_get_squad,
            reflect_delete_squad,
            reflect_delegate_next,
            reflect_assign_squad_task,
            // 媒体工作室 + 电脑操控（仅元数据的后端）
            reflect_list_media,
            reflect_image_process,
            reflect_screenshot,
            reflect_computer_use,
            reflect_media_capabilities,
            reflect_set_dock_badge,
            // Traces —— 本地 LLM 调用记录只读查询(CLI `reflect traces` 的 GUI 对应)
            reflect_list_traces,
            // 运行时状态只读面(凭证池健康度 / 已完成子代理调用 / 记忆分段 / 配置位置)
            reflect_credential_pool_status,
            reflect_recovery_state,
            reflect_memory_sections,
            reflect_config_info,
            // MCP 服务管理(增删 + 精选 catalog)—— 扩展机制的自助入口
            reflect_list_mcp_servers,
            reflect_mcp_catalog,
            reflect_upsert_mcp_server,
            reflect_delete_mcp_server,
            reflect_list_mcp_resources,
            reflect_list_mcp_prompts,
            // 子代理 spec(`call_<role>` 工具的来源)—— 此前无任何编辑面
            reflect_list_subagent_specs,
            reflect_get_subagent_spec,
            reflect_save_subagent_spec,
            reflect_delete_subagent_spec,
            reflect_get_trace,
            // Span 日志(turn → model → tool 父子链 + goal 事件)
            reflect_list_span_logs,
            reflect_read_span_log,
            // 多 agent 讨论(CLI `reflect discussion` 的 GUI 对应;Collab* 事件
            // 经 session broadcast 实时推送,前端 collab_* reducer 既有渲染)
            reflect_list_discussions,
            reflect_run_discussion,
            // DAG 流水线(CLI `reflect pipeline` 的 GUI 对应;team 四阶段预设 + TOML DAG)
            reflect_run_team_pipeline,
            // 安全扫描(cargo audit)—— 核心真实实现,GUI 此前只能开终端跑
            reflect_run_security_scan,
            // Pipeline 配置编辑(实时校验 + 落盘)—— 此前只能跑手写文件
            reflect_validate_pipeline,
            reflect_list_pipeline_configs,
            reflect_save_pipeline_config,
            reflect_run_pipeline,
            // 会话统计(模型级 token 用量 / 压缩节省 / 记忆访问)—— 只读扫描 rollout JSONL
            reflect_session_stats,
            reflect_all_model_usage,
            // 模型费率卡(核心静态费率表反解)—— 让费用在 GUI 里可解释
            reflect_model_rate_cards,
            // 权限规则:只读查询(核心三层 store 的生效规则)+ 追加用户级 allow 规则
            // (审批弹窗的「始终允许这条命令」—— 落进核心的 permissions.toml,立即生效)
            reflect_list_permission_rules,
            reflect_add_permission_rule,
            // 会话笔记只读查询(agent 写下的持久笔记)—— 让 agent 记的东西可见
            reflect_list_session_notes,
            reflect_list_note_sessions,
            // 活跃 agent(决定加载哪条 agent 定义 + 记忆目录)
            reflect_get_active_agent,
            reflect_set_active_agent,
            // OS 沙箱有效状态(Seatbelt / Landlock 是否真的生效)
            reflect_sandbox_status,
            // 当前模型实际生效的提示词正文(按模型匹配后解析的结果)
            reflect_get_effective_prompt,
            // 提示词层管理(`/prompt` slash)—— Op 递进引擎,应答走 reflect_event 通道
            reflect_prompt_command,
        ])
        // ====== Window 事件:macOS close-to-tray ======
        .on_window_event(|window, event| {
            menu::handle_close_to_tray(window, event);
        })
}

/// 启动 Tauri 应用:
///
/// 1. 注册 `MinimalAgent` (M2.x = 真 `reflect_core::AgentThread` + stub model);
/// 2. 注册全部 reflect command + ping + `reflect_set_dock_badge`;
/// 3. 注册 `tauri-plugin-global-shortcut` plugin;
/// 4. 在 setup 中:
///     - 启动 `forward_agent_events` 把 agent event 推到前端;
///     - 注册全局快捷键 + 应用菜单 + 托盘图标;
///     - 启动 `AgentThread` 的 会话事件转发器;
/// 5. `on_window_event` 拦截 macOS 关闭按钮 → hide (close-to-tray)。
///
/// 命令面来自 [`configure`] —— 与能力覆盖层测试共用同一份。
pub fn run() {
    tracing_subscriber::fmt::init();

    configure(tauri::Builder::<tauri::Wry>::new())
        // ====== Menu (在 builder 阶段静态注入) ======
        .menu(menu::build_menu)
        .on_menu_event(menu::handle_menu_event)
        // ====== Setup ======
        .setup(|app: &mut tauri::App<tauri::Wry>| {
            // 0. 把应用句柄注入托管状态 —— 命令层做 OS 交互(原生对话框 /
            //    dock 徽标 / 终端事件推送)时从这里取句柄,命令签名因此不必
            //    收 `AppHandle`,也就不与 runtime 绑死。
            app.state::<MinimalAgent>()
                .set_app_handle(app.handle().clone());

            // 1. 系统托盘 (macOS-only,其他平台为 no-op)。Tray 必须在 setup 同步阶段建
            //    (因为 tray 注册在 sync builder context)。
            tray::build_tray(app.handle())?;

            // 2. 全局快捷键 (跨平台,plugin 注册)。
            //    注册失败(如 Cmd+Shift+Space 被截图/启动器类应用占用)只降级
            //    记日志,不阻断启动 —— 此前 `?` 上抛会让 run(...) panic,
            //    应用完全无法打开。
            if let Err(e) = shortcut::register_global_shortcuts(app.handle()) {
                tracing::warn!("[reflect-gui] global shortcut registration failed, continuing without it: {e}");
            }

            // 3. 启动时清空 dock badge。
            dock::set_dock_badge(app.handle(), None);

            // 4. 二段构造 AgentThread —— Tauri setup 闭包**不是** tokio runtime
            //    上下文,必须用 tauri::async_runtime::spawn 把 install 推迟到
            //    Tauri 内部 runtime 起来之后 (event loop 阶段)。
            //
            //    install_agent_thread() 内部会构造真 AgentThread (内部 tokio::spawn
            //    submission_loop) 并启动 session forwarder。
            let agent_for_install: MinimalAgent = (*app.state::<MinimalAgent>()).clone();
            tauri::async_runtime::spawn(async move {
                agent_for_install.install_agent_thread().await;
            });

            // 5. 启动 broadcast → Tauri event 转发 (独立于 install,可在 sync setup
            //    后立刻 spawn,broadcast channel 已 ready,subscriber 可以先于 agent
            //    安装;eventual lag 由 Tauri Emitter 端容忍)。
            let agent_for_forward: MinimalAgent = (*app.state::<MinimalAgent>()).clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let session_rx = agent_for_forward.subscribe_session();
                events::forward_agent_events(app_handle, session_rx).await;
            });

            tracing::info!(
                "[reflect-gui] setup complete (model={}, workspace={}); agent thread installing in async runtime",
                app.state::<MinimalAgent>().model_spec(),
                app.state::<MinimalAgent>().workspace().display()
            );

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running reflect-desktop");
}

// `ping` 命令体见 [`commands::health`] —— 单独成模块:`ping` 必须是 `pub`
// 才能被能力覆盖层测试经**真实** IPC 通路打(命令宏需 `#[macro_export]` 到
// crate 根;定义在 crate 根会与导出位置冲突)。
