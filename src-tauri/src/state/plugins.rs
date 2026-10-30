//! 插件运行时接线 —— `[plugins] enabled_plugins` 挂载 + `/plugin:*` 输入展开。
//!
//! 上游(`reflect-exec`)在 headless bootstrap 里挂插件、在 submit 前展开
//! slash 命令;桌面端 thread 走自装配(`thread_factory::construct_thread`),
//! 本模块把同样的两件事接到 GUI 生命周期上:
//!
//! - **挂载**:真实会话提交到线程槽后，异步执行「结束旧插件会话 →
//!   卸旧 runtime → bootstrap 新 runtime」。首个 SessionStart 和用户
//!   输入等待挂载完成，避免遗漏插件 hook 与命令。
//!   exec 是单会话进程,桌面端一个进程多个会话,因此挂载与线程同寿:
//!   每次 rebind 重建 runtime(新线程的 hook_engine / skills catalog /
//!   SubAgentFactory 都是新实例),旧 runtime 显式 `reload_plugins(&old, &[])`
//!   卸载(drop 不会反注册,插件 MCP server 进程与共享 ToolRegistry 里的
//!   Plugin 工具都会泄漏)。多次 rebind 的竞态由 [`MinimalAgentInner::
//!   plugin_mount_lock`] 与配置更新串行化；过期线程的挂载会被丢弃。
//! - **展开**:[`expand_submission`] 在 `MinimalAgent::submit` 投递前把
//!   `Op::UserInput` 首个 Text 条目命中插件命令时替换为命令正文并标注
//!   `Submission::source_command`(与 exec `expand_plugin_command` 语义
//!   一致:未命中透传、命中但读取失败报错)。steer / 其他 Op 不展开
//!   (v1 与 exec 的 submit 边界对齐)。
//!
//! 有意与 exec 不同的两点:
//! - 插件 MCP server 用**每挂载一份**的专用 `McpConnectionManager`
//!   (exec 的 `mcp_for_plugins` 同款),不并入 `mcp.rs` 的用户 MCP manager
//!   —— 后者由 install 异步启动,没有可复用的句柄。lifecycle 事件
//!   (Started/Failed)经 `mcp::spawn_mcp_lifecycle_forwarder` 推 session
//!   broadcast,前端与用户 MCP 同通道可见。
//! - `SubAgentFactory` 只作插件 agents 能力的挂载点,**不注册内置子代理
//!   spec**(没有 explorer 回退)—— 桌面端内置 call_* 工具是独立 feature,
//!   不随插件接线顺带引入。

use std::sync::Arc;

use reflect_core::AgentThread;
use reflect_core::config::M4Deps;
use reflect_hooks::HookEngine;
use reflect_llm::SharedModelRegistry;
use reflect_mcp::McpConnectionManager;
use reflect_plugin::{SharedPluginRuntime, bootstrap_plugins, reload_plugins};
use reflect_protocol::{Op, Submission, ThreadId, UserInputItem};
use reflect_subagent::SubAgentFactory;

use super::MinimalAgent;

/// 将有效插件 ID 规范化并去重；保留无效值以便上游报告配置错误。
pub(crate) fn canonical_enabled(enabled: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    enabled
        .iter()
        .map(|id| {
            reflect_plugin::PluginId::parse_user_input(id)
                .map(|parsed| parsed.to_string())
                .unwrap_or_else(|_| id.clone())
        })
        .filter(|id| seen.insert(id.clone()))
        .collect()
}

#[derive(Clone)]
pub(crate) struct PluginRuntimeContext {
    tools: Arc<reflect_tools::ToolRegistry>,
    hooks: Arc<HookEngine>,
    mcp: Arc<McpConnectionManager>,
    skills: Arc<reflect_skills::SkillsCatalog>,
    factory: Arc<SubAgentFactory>,
    event_tx: tokio::sync::mpsc::Sender<reflect_protocol::Event>,
    pub(crate) status: Arc<super::plugin_status::PluginStatus>,
    pub(crate) owner: std::sync::Weak<AgentThread>,
    bridge: Arc<super::plugin_hooks::PluginHookBridge>,
}

/// 在事件派发暂停期间更新插件并恢复钩子偏好。
/// 调用方持有 plugin_mount_lock。
pub(crate) async fn reload_enabled_plugins(
    agent: &MinimalAgent,
    enabled: &[String],
) -> anyhow::Result<()> {
    let enabled = canonical_enabled(enabled);
    let context = agent.inner.plugin_runtime_context.lock().clone();
    let Some(context) = context else {
        return Ok(());
    };
    let _gate = context.bridge.reload_gate.write().await;
    let shared = agent.plugin_runtime();
    if let Err(error) = agent.inner.hook_store.apply_disabled(&HookEngine::new()) {
        reload_plugins(&shared, &[]).await;
        context.status.clear().await?;
        return Err(error);
    }
    if let Err(error) = context.status.retain_enabled(&enabled).await {
        reload_plugins(&shared, &[]).await;
        return Err(error);
    }
    reload_plugins(&shared, &enabled).await;
    if let Err(error) = agent.inner.hook_store.apply_disabled(&context.hooks) {
        reload_plugins(&shared, &[]).await;
        context.status.clear().await?;
        return Err(error);
    }
    Ok(())
}

/// 安装清单发生变化后重建运行时，以读取最新的插件管理器快照。
/// 调用方持有 plugin_mount_lock。
pub(crate) async fn refresh_installed_plugins(agent: &MinimalAgent) -> anyhow::Result<()> {
    let context = agent.inner.plugin_runtime_context.lock().clone();
    let Some(context) = context else {
        return Ok(());
    };
    let _gate = context.bridge.reload_gate.write().await;
    let enabled = canonical_enabled(&agent.inner.cfg.read().plugins.enabled_plugins);
    let shared = agent.plugin_runtime();
    reload_plugins(&shared, &[]).await;
    context.status.clear().await?;
    agent.inner.hook_store.apply_disabled(&HookEngine::new())?;
    let runtime = bootstrap_plugins(
        context.tools,
        context.hooks.clone(),
        context.mcp,
        context.skills,
        context.factory,
        &enabled,
        Some(context.event_tx.clone()),
    )
    .await;
    if let Err(error) = agent.inner.hook_store.apply_disabled(&context.hooks) {
        reload_plugins(&runtime, &[]).await;
        context.status.clear().await?;
        *shared.lock().await = None;
        return Err(error);
    }
    *shared.lock().await = runtime.lock().await.take();
    Ok(())
}

/// `construct_thread` 收集的挂载材料(sync 侧只收集,异步任务里真挂)。
pub(crate) struct PluginMount {
    pub(crate) sid: ThreadId,
    pub(crate) thread: Arc<AgentThread>,
    pub(crate) hook_engine: Arc<HookEngine>,
    pub(crate) bridge: Arc<super::plugin_hooks::PluginHookBridge>,
    pub(crate) ready: tokio::sync::watch::Sender<bool>,
    pub(crate) activation: tokio::sync::watch::Receiver<bool>,
    pub(crate) m4: M4Deps,
    pub(crate) model: String,
    pub(crate) registry: SharedModelRegistry,
    /// `[subagent_providers]` 段构建的子代理独立 registry;`None` = 父子共享
    /// (与 exec `bootstrap_m5` 的 `to_child_registry()` 语义一致)。
    pub(crate) child_registry: Option<SharedModelRegistry>,
}

/// 异步挂载插件运行时，在线程发布后结束旧会话、卸旧并装新。
///
/// `PluginLoaded` 事件经 session broadcast 透传。钩子偏好无法恢复时
/// 停止挂载并拒绝提交，避免静默绕过用户的禁用设置。
pub(crate) fn spawn_mount(agent: &MinimalAgent, mount: PluginMount) {
    let status = super::plugin_status::PluginStatus::new(agent.inner.session_tx.clone());
    let event_tx = status.events.clone();

    let inner = Arc::clone(&agent.inner);
    let tools = agent.inner.tools.clone();
    let mount_lock = Arc::clone(&agent.inner.plugin_mount_lock);
    let session_tx = agent.session_tx();
    let PluginMount {
        sid,
        thread,
        hook_engine,
        bridge,
        ready,
        mut activation,
        m4,
        model,
        registry,
        child_registry,
    } = mount;

    tauri::async_runtime::spawn(async move {
        if !*activation.borrow_and_update() {
            tokio::select! {
                result = activation.changed() => if result.is_err() || !*activation.borrow_and_update() { return; },
                _ = thread.cancel_token().cancelled() => return,
            }
        }
        // 串行化:与并发 rebind 的挂载任务互斥,「卸旧→装新→写句柄」
        // 不交叉；线程被替换后，尚未执行的旧挂载直接丢弃。
        let _guard = mount_lock.lock().await;
        if thread.cancel_token().is_cancelled() {
            return;
        }
        // 配置可能在任务排队时已更新，不能使用构造线程时的旧快照。
        let enabled = canonical_enabled(&inner.cfg.read().plugins.enabled_plugins);

        // 1. 卸旧:drop 不反注册,必须显式清到空集(停插件 MCP server、
        //    清共享 ToolRegistry 的 Plugin 工具)。首装时内层为 None,
        //    no-op。句柄 Arc 终身不变,变的是内层 Option<PluginRuntime>。
        let previous = inner.mounted_plugin_bridge.lock().take();
        *inner.plugin_runtime_context.lock() = None;
        if let Some(previous) = previous {
            previous.finish().await;
        }
        let old = Arc::clone(&inner.plugin_runtime);
        reload_plugins(&old, &[]).await;

        // 2. 插件专用 MCP manager(生命周期随本次挂载)。lifecycle 事件
        //    (Started/Failed)复用 mcp.rs 的转换器推 session broadcast,
        //    前端与用户 MCP 同一通道可见插件的 server 启动/失败。
        let (lifecycle_tx, lifecycle_rx) =
            tokio::sync::mpsc::channel::<reflect_mcp::McpLifecycleEvent>(16);
        let mcp = Arc::new(McpConnectionManager::new(lifecycle_tx));
        crate::mcp::spawn_mcp_lifecycle_forwarder(lifecycle_rx, session_tx);

        // 3. 最小 SubAgentFactory:只作插件 agents 能力的挂载点,不注册
        //    内置 spec(详见模块文档)。取消令牌绑本线程:rebind 取消旧
        //    线程时,旧 factory 及其未完成的子代理随之取消。
        let factory = Arc::new(SubAgentFactory::new(
            sid,
            model,
            registry.clone(),
            child_registry,
            tools.clone(),
            thread.cancel_token().clone(),
            m4.recorder.clone(),
        ));
        factory.set_subagent_registry(m4.subagent_registry.clone());
        factory.set_parent_skills(m4.skills.clone());

        // 4. 装新并写回句柄(exec/serve/门面同一入口)。bootstrap_plugins
        //    返回独立的新 Arc,这里只取其内层 PluginRuntime 挂到常驻句柄上。
        let context = PluginRuntimeContext {
            tools,
            hooks: hook_engine.clone(),
            mcp,
            skills: m4.skills.clone(),
            factory,
            event_tx: event_tx.clone(),
            status,
            owner: Arc::downgrade(&thread),
            bridge: bridge.clone(),
        };
        let runtime = bootstrap_plugins(
            context.tools.clone(),
            context.hooks.clone(),
            context.mcp.clone(),
            context.skills.clone(),
            context.factory.clone(),
            &enabled,
            Some(event_tx),
        )
        .await;
        if let Err(error) = inner.hook_store.apply_disabled(&hook_engine) {
            tracing::warn!(%error, "failed to restore hook preferences after plugin mount");
            reload_plugins(&runtime, &[]).await;
            return;
        }
        let mounted = runtime.lock().await.take();
        *inner.plugin_runtime.lock().await = mounted;
        *inner.plugin_runtime_context.lock() = Some(context);
        *inner.mounted_plugin_bridge.lock() = Some(bridge);
        ready.send_replace(true);
        tracing::debug!(
            "[reflect-gui] plugin runtime mounted (enabled={:?})",
            enabled
        );
    });
}

/// submit 边界的插件命令展开:命中 `/plugin:ns:name args` 时把首个
/// Text 条目替换为命令正文,并标注 `source_command`。语义与 exec 的
/// `expand_plugin_command` 一致:
/// - 非 `UserInput` op / 输入未命中任何已挂载命令 → 原样透传;
/// - 命中但命令文件读取失败 → `Err`(命令层把错误推前端,消息不投递)。
pub(crate) async fn expand_submission(
    plugin_runtime: &SharedPluginRuntime,
    submission: Submission,
) -> anyhow::Result<Submission> {
    // 快照命令表并尽快释放 runtime 锁 —— 展开期间的文件 IO 不占锁;
    // 未挂载(内层 None)时直通。
    let registry = {
        let guard = plugin_runtime.lock().await;
        match guard.as_ref() {
            Some(rt) => rt.commands(),
            None => return Ok(submission),
        }
    };
    expand_with_registry(&registry, submission)
}

/// 展开内核(生产路径与单测共用):对 `Op::UserInput` 首个 Text 条目做
/// 插件命令匹配与替换;其余 op 原样透传。
fn expand_with_registry(
    registry: &reflect_plugin::CommandRegistry,
    mut submission: Submission,
) -> anyhow::Result<Submission> {
    let text = match &submission.op {
        Op::UserInput { items, .. } => items.iter().find_map(|item| match item {
            UserInputItem::Text { text } => Some(text.clone()),
            _ => None,
        }),
        _ => return Ok(submission),
    };
    // 无文本条目(纯图片等)或非 `/` 开头:不做命令查找。
    let Some(text) = text.filter(|t| t.trim_start().starts_with('/')) else {
        return Ok(submission);
    };

    match reflect_plugin::expand_user_input(&text, registry) {
        None => Ok(submission),
        Some(Ok(expanded)) => {
            tracing::info!(command = %expanded.name, "plugin command expanded");
            // md 文件通常带尾换行;GUI 消息正文去掉尾空白(exec 原样提交,
            // 这里是为聊天视图整洁,语义无损)。
            replace_first_text(&mut submission, expanded.body.trim_end());
            submission.source_command = Some(expanded.name);
            Ok(submission)
        }
        Some(Err(e)) => {
            let name = text
                .split_whitespace()
                .next()
                .unwrap_or("")
                .trim_start_matches('/');
            Err(anyhow::anyhow!("插件命令 `{name}` 展开失败: {e}"))
        }
    }
}

/// 把 submission 首个 Text 条目的正文替换为展开结果(其余条目不动)。
fn replace_first_text(submission: &mut Submission, body: &str) {
    if let Op::UserInput { items, .. } = &mut submission.op {
        for item in items.iter_mut() {
            if let UserInputItem::Text { text } = item {
                *text = body.to_string();
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use reflect_plugin::{CommandRegistry, LoadedCommand};
    use std::path::PathBuf;

    fn submission_with_text(text: &str) -> Submission {
        Submission::user_input(text.to_string())
    }

    fn first_text(submission: &Submission) -> Option<&str> {
        match &submission.op {
            Op::UserInput { items, .. } => items.iter().find_map(|item| match item {
                UserInputItem::Text { text } => Some(text.as_str()),
                _ => None,
            }),
            _ => None,
        }
    }

    fn registry_with_command(name: &str, body_file: &std::path::Path) -> CommandRegistry {
        let registry = CommandRegistry::new();
        registry.add_plugin(
            "demo",
            vec![LoadedCommand {
                name: name.to_string(),
                file_path: body_file.to_path_buf(),
                description: None,
            }],
        );
        registry
    }

    /// 未命中(普通文本 / 未知命令 / 非 `/` 开头)→ 原样透传,
    /// `source_command` 不标注。
    #[tokio::test]
    async fn passthrough_when_no_command_matches() {
        let registry = CommandRegistry::new();

        for text in ["plain question", "/unknown args", "/", "  / spaced"] {
            let out = expand_with_registry(&registry, submission_with_text(text)).unwrap();
            assert_eq!(first_text(&out), Some(text), "必须透传: {text}");
            assert_eq!(out.source_command, None);
        }
    }

    /// 命中命令:Text 正文替换 + `source_command` 标注;`$ARGUMENTS`
    /// 替换为命令后参数;md 尾换行被去除。
    #[tokio::test]
    async fn expands_matched_command_and_tags_source() {
        let dir = tempfile::tempdir().unwrap();
        let cmd = dir.path().join("hello.md");
        std::fs::write(&cmd, "---\ndescription: demo\n---\nSay hi to $ARGUMENTS.\n").unwrap();
        let registry = registry_with_command("demo:hello", &cmd);

        let out =
            expand_with_registry(&registry, submission_with_text("/demo:hello world")).unwrap();
        assert_eq!(first_text(&out), Some("Say hi to world."));
        assert_eq!(out.source_command.as_deref(), Some("demo:hello"));
    }

    /// 命中但命令文件读取失败 → `Err`(消息不投递,错误推前端)。
    #[tokio::test]
    async fn errors_when_command_file_unreadable() {
        let registry = registry_with_command("demo:gone", &PathBuf::from("/nonexistent/hello.md"));

        let err = expand_with_registry(&registry, submission_with_text("/demo:gone")).unwrap_err();
        assert!(err.to_string().contains("demo:gone"));
    }

    /// 非 `UserInput` op(如 Compact)不做任何展开,直接透传。
    #[tokio::test]
    async fn non_user_input_ops_pass_through() {
        let registry = CommandRegistry::new();

        let submission = Submission::with_id("op-1", Op::Compact);
        let out = expand_with_registry(&registry, submission).unwrap();
        assert_eq!(out.id, "op-1");
    }

    /// 未挂载(内层 None)时 `expand_submission` 直通,即使输入形如命令。
    #[tokio::test]
    async fn expand_submission_passes_through_when_unmounted() {
        let rt: SharedPluginRuntime = Arc::new(tokio::sync::Mutex::new(None));
        let out = expand_submission(&rt, submission_with_text("/demo:hello world"))
            .await
            .unwrap();
        assert_eq!(first_text(&out), Some("/demo:hello world"));
        assert_eq!(out.source_command, None);
    }
}
