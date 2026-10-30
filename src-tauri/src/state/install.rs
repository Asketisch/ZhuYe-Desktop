//! `install_agent_thread` —— 二段构造的第二阶段。
//!
//! 必须跑在 tokio runtime 上下文(Tauri setup 闭包内或后续被
//! `tauri::async_runtime::spawn` 推迟的 task 内),因为 `AgentThread::new`
//! 内部立即 `tokio::spawn(submission_loop(...))`。
//!
//! v1.x 重构:registry / thread 构造全走 `state::thread_factory`,本文件
//! 只负责拼装 + 安装 forwarder / cron / MCP-LSP bootstrap。

use std::sync::Arc;

use reflect_tools::{
    ToolRegistry,
    builtins::{
        BashTool, DeleteTool, EditTool, EnterPlanModeTool, EnterWorktreeTool, ExitPlanModeTool,
        ExitWorktreeTool, GlobTool, GrepTool, NotebookEditTool, ReadTool, ToolSearchTool,
        WebFetchTool, WebSearchTool, WriteTool,
    },
};

use super::MinimalAgent;

/// 第二阶段:在 Tauri setup 闭包内调用,真构造 AgentThread + 启动 forwarder。
///
/// ## 重要
///
/// `AgentThread::new` 内部立即 `tokio::spawn(submission_loop(...))`,
/// 必须跑在 tokio runtime 上下文。Tauri `setup` 闭包运行时 Tauri 已经
/// 初始化了它的 async_runtime,这一步安全。
///
/// 本函数是 `async` 的 —— model spec 的解析可能要打 provider 的模型清单
/// 端点(`model = "free"` 这类动态值),那是网络 I/O。
pub(crate) async fn install_agent_thread(agent: &MinimalAgent) {
    // 1. 读 cfg 快照。
    let cfg_snapshot = agent.inner.cfg.read().clone();
    let workspace = agent.inner.workspace.clone();

    // 2. 注册内置工具到共享 registry(MCP/LSP 后续也注册进来)。
    let tools = agent.inner.tools.clone();
    register_builtin_tools(&tools);
    // 2a. 任务工具 —— GUI 里有任务板,agent 也得能驱动它(此前只有 GUI 侧
    //     的 CRUD,agent 既看不到也改不了任务)。
    super::subagents::register_task_tools(&tools, agent.task_manager());

    // 3. 构造 ModelRegistry(provider / degraded 两分支)。
    //    注意:registry **先不发布**到 inner —— 步骤 3c 的 model spec 解析
    //    可能要打 provider 的模型清单端点(最长 ~20s)。这段窗口里
    //    `model_registry_ready()` 必须保持 false,否则前端发来的 bind 命令
    //    会用「还没解析的」model spec 构造线程(动态值场景 = 占位串)。
    let registry = super::thread_factory::build_registry(&cfg_snapshot, Arc::clone(&tools));

    // 3a. coding plan 配额追踪器:config 声明了 quota 的 credential 才会
    //     构建(Some);全无声明 → None(与 headless 行为对齐)。
    super::quota::install_quota_tracker(agent, &cfg_snapshot);

    // 3b. 旧版桌面端记忆目录(`agent-memory/reflect/`)→ 当前活跃 agent
    //     目录的迁移。记忆路径由 agent 名派生,不迁就会「GUI 写的记忆
    //     agent 读不到」。失败只记日志,不阻断启动。
    crate::memory_store::migrate_legacy_memory_dir(&workspace);

    // 3c. 解析 model spec —— **必须**在 registry 建好之后:`model = "free"`
    //     这类动态值要从 provider 的模型清单里挑(清单来源就是 registry),
    //     解析要打网络。解析失败 → 降级原因如实上报,model 落 `stub/test`
    //     —— 绝不落占位串 `"provider/free"`:那是发给 provider 的假模型名,
    //     表现为难诊断的「模型不存在」。
    reflect_config::discovery::clear_catalog_cache();
    let (resolved_spec, discovery_error) =
        super::agent::resolve_model_spec_with_discovery(&cfg_snapshot, &registry).await;
    let model_spec = resolved_spec.unwrap_or_else(|| "stub/test".to_string());
    *agent.inner.model_spec.write() = model_spec.clone();
    *agent.inner.pending_model_discovery_error.lock() = discovery_error.clone();
    *agent.inner.degraded_reason.lock() =
        super::agent::compute_degraded_reason(&cfg_snapshot).or(discovery_error);
    // 3d. 解析完成后再发布 registry —— bind 命令在这之前一律拒绝。
    *agent.inner.model_registry.lock() = Some(registry);

    // 4. 构造占位 AgentThread(sid = None,不挂 recorder / 不固定 id)。
    //    占位 thread 给首条消息前的 health-check / 状态命令兜底;
    //    `reflect_bind_session` 会触发 rebind 把它换成带 recorder 的真 thread。
    let thread = match super::thread_factory::construct_thread(agent, None, vec![], None) {
        Ok(thread) => thread,
        Err(error) => {
            let message = format!("failed to construct agent thread: {error:#}");
            tracing::error!("{message}");
            *agent.inner.degraded_reason.lock() = Some(message);
            *agent.inner.model_registry.lock() = None;
            return;
        }
    };
    // 5. 写回 inner(共享 registry 已在步骤 3d 记入 inner,rebind 复用)。
    *agent.inner.thread.lock() = Some(thread.clone());
    *agent.inner.task_hook_target.write() = Some(thread.hook_engine());

    // 6. 启动会话事件转发器。
    super::session::start_forwarder(agent);

    // 6a. 启动 Activity logger 订阅:独立 broadcast receiver
    //     把每个 Event 映射成 ActivityEvent 写入本地 timeline,与 forwarder
    //     互不阻塞。
    super::activity::subscribe_activity_logger(agent);

    // 6b. 注入 Cron 调度器 + 启动后台 driver。
    //
    // v1.x 修复:此前 `let _driver_handle = driver.start(30)` 立即 drop
    // 句柄 → driver 任务被 abort → cron 永不触发。现在把句柄存到
    // `inner.cron_driver`,rebind_session 时 stop 旧 driver + 换 sender
    // 后重启,保持 jobs Arc 不变。
    let cron_sender = thread.submission_sender();
    if let Some(mut previous) = agent.inner.cron_driver.lock().take() {
        previous.stop();
    }
    let (scheduler, driver_handle) = agent.spawn_cron_scheduler(cron_sender);
    *agent.inner.cron_scheduler.write() = Some(scheduler);
    *agent.inner.cron_driver.lock() = Some(driver_handle);

    // 7. MCP / LSP bootstrap—— 读 cfg 的 [mcp_servers]/[lsp_servers],
    //    启动 server + 注册 tool。lifecycle event 经 session broadcast 推前端。
    //    在 async runtime 里跑(bootstrap 内部 tokio::spawn + 网络 I/O)。
    // MCP 保持安装即启动;LSP 改为按工作区手动开启(见 commands/lsp.rs):
    // 默认不注册 `lsp` tool、不起 server,避免多项目同时撑起多份语言
    // 服务拖累系统。前端在用户开启后调 `reflect_lsp_set_enabled`。
    {
        // 与设置命令串行化，发布 manager 后才允许后台启动或修改配置。
        let _config = agent.inner.config_write_lock.lock().await;
        let current_cfg = agent.inner.cfg.read().clone();
        let (manager, invoked_tx) = crate::mcp::bootstrap_mcp(
            agent,
            &current_cfg,
            tools.clone(),
            agent.inner.session_tx.clone(),
        )
        .await;
        *agent.inner.mcp_manager.lock() = Some(manager.clone());
        *agent.inner.mcp_invoked_tx.lock() = Some(invoked_tx);
        tools.register(Arc::new(reflect_mcp::ListMcpResourcesTool::new(
            manager.clone(),
        )));
        tools.register(Arc::new(reflect_mcp::ReadMcpResourceTool::new(
            manager.clone(),
        )));
        tools.register(Arc::new(reflect_mcp::ListMcpPromptsTool::new(
            manager.clone(),
        )));
        tools.register(Arc::new(reflect_mcp::GetMcpPromptTool::new(manager)));
    }

    tracing::info!(
        "[reflect-gui] AgentThread installed (model={}, workspace={}, degraded={})",
        model_spec,
        workspace.display(),
        agent.inner.degraded_reason.lock().is_some()
    );
}

/// 注册 16 个 reflect-tools 内置工具到 `ToolRegistry`。
///
/// `ToolSearchTool` 需要持有 registry 句柄,最后注册(否则它搜不到其他工具)。
/// 全部工具零参数构造(除 ToolSearchTool)。
fn register_builtin_tools(tools: &Arc<ToolRegistry>) {
    // 文件/执行类。
    tools.register(Arc::new(BashTool::default()));
    tools.register(Arc::new(ReadTool));
    tools.register(Arc::new(WriteTool));
    tools.register(Arc::new(EditTool));
    tools.register(Arc::new(DeleteTool));
    tools.register(Arc::new(GrepTool));
    tools.register(Arc::new(GlobTool));
    tools.register(Arc::new(NotebookEditTool));
    // Plan / Worktree。
    tools.register(Arc::new(EnterPlanModeTool));
    tools.register(Arc::new(ExitPlanModeTool));
    tools.register(Arc::new(EnterWorktreeTool));
    tools.register(Arc::new(ExitWorktreeTool));
    // Web。
    tools.register(Arc::new(WebFetchTool::new()));
    tools.register(Arc::new(WebSearchTool::new()));
    // 工具搜索 —— 持有 registry 句柄,最后注册。
    tools.register(Arc::new(ToolSearchTool::new(Arc::clone(tools))));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::MinimalAgent;

    #[test]
    fn register_builtin_tools_populates_registry() {
        let tools = Arc::new(ToolRegistry::new());
        register_builtin_tools(&tools);
        let names = tools.list();
        // 15 个内置工具(不含 EchoTool —— 仅降级模式注册)。
        // 注意:工具 name() 与 struct 名不一致,且风格混杂 ——
        // 多数 snake_case,但 plan/worktree 系列是 PascalCase(上游历史遗留)。
        for expected in [
            "bash",
            "read",
            "write",
            "edit",
            "delete_file",
            "grep",
            "glob",
            "notebook_edit",
            "EnterPlanMode",
            "ExitPlanMode",
            "EnterWorktree",
            "ExitWorktree",
            "web_fetch",
            "web_search",
            "tool_search",
        ] {
            assert!(
                names.contains(&expected.to_string()),
                "missing tool: {expected}"
            );
        }
    }

    /// 任务工具必须注册 —— GUI 里有任务板,agent 也得能驱动它。
    ///
    /// 此前桌面端只注册 15 个基础工具,任务工具**缺失** → GUI 建的 task
    /// agent 既看不到也改不了(CLI 侧经 `reflect_task::register_task_tools`
    /// 注册)。
    #[test]
    fn task_tools_are_registered() {
        use reflect_task::{InMemoryTaskStore, InMemoryTeamStore, TaskManager};
        use std::sync::Arc;

        let tools = Arc::new(ToolRegistry::new());
        let mgr = Arc::new(TaskManager::new(
            Arc::new(InMemoryTaskStore::new()),
            Arc::new(InMemoryTeamStore::new()),
        ));
        crate::state::subagents::register_task_tools(&tools, mgr);
        let names = tools.list();
        for expected in [
            "TaskCreate",
            "TaskGet",
            "TaskUpdate",
            "TaskList",
            "TaskStop",
            "TaskOutput",
        ] {
            assert!(
                names.contains(&expected.to_string()),
                "missing task tool: {expected}"
            );
        }
    }

    /// install_agent_thread 必须在 tokio runtime 上下文里调用,
    /// 否则 AgentThread 内部 tokio::spawn 会 panic。
    /// 这里用 tokio::test 验证 install 后状态翻转 + tools 注册数正确。
    #[tokio::test]
    async fn install_populates_state() {
        let agent = MinimalAgent::new_empty();
        // 初始:thread 未安装,model_spec 为 stub。
        assert!(!agent.agent_status().ready);
        assert_eq!(agent.model_spec(), "stub/test");

        // install:读真实 cfg + 注册 15 个内置工具 + 启动 session forwarder。
        // 注意:install 内部会 tauri::async_runtime::spawn MCP bootstrap,
        // 但 tauri::async_runtime::spawn 在 tokio::test runtime 里会复用当前
        // runtime(若 tauri 未单独 init),这里仅验证同步可见状态。
        // 若 MCP bootstrap 网络失败,不影响 install 返回(已被 spawn 隔离)。
        agent.install_agent_thread().await;

        // ready 翻转为 true。
        let status = agent.agent_status();
        assert!(status.ready, "after install: ready must be true");

        // tools:15 个 builtin(若 cfg 有 provider) 或 16 个(+EchoTool 降级)。
        let tool_count = agent.tools().list().len();
        assert!(
            tool_count >= 15,
            "must register at least 15 builtin tools, got {tool_count}"
        );

        // model_spec 不再是 stub(若有 provider);若 cfg 无 provider 则仍是 stub。
        let model = agent.model_spec();
        assert!(
            !model.is_empty(),
            "model_spec must be non-empty after install"
        );

        // interrupt 幂等:install 后调用不应 panic。
        let _ = agent.interrupt().await;
    }

    /// v1.x:install 必须建立 `model_registry`(构造 AgentThread 复用),
    /// 并初始化 `cron_driver` 句柄(否则 cron 永不触发)。
    #[tokio::test]
    async fn install_populates_registry_and_cron_handle() {
        let agent = MinimalAgent::new_empty();
        assert!(!agent.model_registry_ready(), "registry 预置 None");
        agent.install_agent_thread().await;
        assert!(agent.model_registry_ready(), "registry 已建");

        // cron_driver 句柄已存(不是 None),否则 cron 任务被立即 abort。
        let handle = agent.inner.cron_driver.lock();
        assert!(
            handle.is_some(),
            "cron_driver 必须保存驱动句柄,否则 cron 永不触发"
        );
    }

    #[tokio::test]
    async fn restarting_cron_preserves_job_identity_and_disabled_state() {
        let agent = MinimalAgent::new_empty();
        agent.install_agent_thread().await;
        let old = agent.cron_scheduler().unwrap();
        let job = old
            .create("0 9 * * *", "test", Some("probe".into()))
            .unwrap();
        let disabled = old.update(&job.id, None, None, None, Some(false)).unwrap();
        let (sender, _receiver) = tokio::sync::mpsc::channel(1);
        let (restarted, _driver) = agent.spawn_cron_scheduler(sender);
        let restored = restarted
            .get(&job.id)
            .expect("job identity must be preserved");
        assert!(!restored.enabled);
        assert_eq!(restored.created_at, disabled.created_at);
        assert_eq!(restored.next_fire, disabled.next_fire);
        assert_eq!(restarted.list().len(), 1);
    }
}
