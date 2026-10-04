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
pub(crate) fn install_agent_thread(agent: &MinimalAgent) {
    // 1. 读 cfg 快照 + 解析 model spec。
    let cfg_snapshot = agent.inner.cfg.read().clone();
    let workspace = agent.inner.workspace.clone();
    let model_spec = super::agent::resolve_model_spec_with_fallback(&cfg_snapshot)
        .unwrap_or_else(|| "stub/test".to_string());
    *agent.inner.degraded_reason.lock() = super::agent::compute_degraded_reason(&cfg_snapshot);

    // 2. 注册内置工具到共享 registry(MCP/LSP 后续也注册进来)。
    let tools = agent.inner.tools.clone();
    register_builtin_tools(&tools);

    // 3. 构造 ModelRegistry(provider / degraded 两分支)。
    let registry = super::thread_factory::build_registry(&cfg_snapshot, Arc::clone(&tools));
    *agent.inner.model_registry.lock() = Some(registry.clone());

    // 3a. coding plan 配额追踪器:config 声明了 quota 的 credential 才会
    //     构建(Some);全无声明 → None(与 headless 行为对齐)。
    super::quota::install_quota_tracker(agent, &cfg_snapshot);

    // 4. 构造占位 AgentThread(sid = None,不挂 recorder / 不固定 id)。
    //    占位 thread 给首条消息前的 health-check / 状态命令兜底;
    //    `reflect_bind_session` 会触发 rebind 把它换成带 recorder 的真 thread。
    let thread = super::thread_factory::construct_thread(agent, None, vec![], None)
        .expect("install: construct_thread(占位) 不应失败");

    // 5. 写回 inner + 把共享 registry 记入 inner(rebind 复用)。
    *agent.inner.thread.lock() = Some(thread.clone());
    *agent.inner.model_spec.write() = model_spec.clone();

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
    let (scheduler, driver_handle) = agent.spawn_cron_scheduler(cron_sender);
    *agent.inner.cron_scheduler.write() = Some(scheduler);
    *agent.inner.cron_driver.lock() = Some(driver_handle);

    // 7. MCP / LSP bootstrap—— 读 cfg 的 [mcp_servers]/[lsp_servers],
    //    启动 server + 注册 tool。lifecycle event 经 session broadcast 推前端。
    //    在 async runtime 里跑(bootstrap 内部 tokio::spawn + 网络 I/O)。
    // MCP 保持安装即启动;LSP 改为按工作区手动开启(见 commands/lsp.rs):
    // 默认不注册 `lsp` tool、不起 server,避免多项目同时撑起多份语言
    // 服务拖累系统。前端在用户开启后调 `reflect_lsp_set_enabled`。
    let cfg_for_bootstrap = cfg_snapshot.clone();
    let tools_for_bootstrap = tools.clone();
    let session_tx_for_bootstrap = agent.inner.session_tx.clone();
    let inner_for_mcp = agent.inner.clone();
    tauri::async_runtime::spawn(async move {
        // v1.6 接线:bootstrap_mcp 返回的 manager 此前被 `let _ =` 丢弃
        // —— 4 个 MCP meta 工具(Resources 二件套 + Prompts 二件套)都
        // 需要持有 manager Arc。现在:config 为空时也挂空 manager(工具
        // 对空列表返回友好结果,与 exec/TUI 对齐),把句柄存进 inner 供
        // 后续热重载 diff 重启用,并注册 meta 工具。
        let manager = crate::mcp::bootstrap_mcp(
            &cfg_for_bootstrap,
            tools_for_bootstrap.clone(),
            session_tx_for_bootstrap,
        )
        .await
        .unwrap_or_else(|| {
            let (tx, _rx) = tokio::sync::mpsc::channel::<reflect_mcp::McpLifecycleEvent>(16);
            std::sync::Arc::new(reflect_mcp::McpConnectionManager::new(tx))
        });
        *inner_for_mcp.mcp_manager.lock() = Some(manager.clone());
        tools_for_bootstrap.register(std::sync::Arc::new(reflect_mcp::ListMcpResourcesTool::new(
            manager.clone(),
        )));
        tools_for_bootstrap.register(std::sync::Arc::new(reflect_mcp::ReadMcpResourceTool::new(
            manager.clone(),
        )));
        tools_for_bootstrap.register(std::sync::Arc::new(reflect_mcp::ListMcpPromptsTool::new(
            manager.clone(),
        )));
        tools_for_bootstrap.register(std::sync::Arc::new(reflect_mcp::GetMcpPromptTool::new(
            manager,
        )));
    });

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
        agent.install_agent_thread();

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
        agent.interrupt();
    }

    /// v1.x:install 必须建立 `model_registry`(构造 AgentThread 复用),
    /// 并初始化 `cron_driver` 句柄(否则 cron 永不触发)。
    #[tokio::test]
    async fn install_populates_registry_and_cron_handle() {
        let agent = MinimalAgent::new_empty();
        assert!(!agent.model_registry_ready(), "registry 预置 None");
        agent.install_agent_thread();
        assert!(agent.model_registry_ready(), "registry 已建");

        // cron_driver 句柄已存(不是 None),否则 cron 任务被立即 abort。
        let handle = agent.inner.cron_driver.lock();
        assert!(
            handle.is_some(),
            "cron_driver 必须保存驱动句柄,否则 cron 永不触发"
        );
    }
}
