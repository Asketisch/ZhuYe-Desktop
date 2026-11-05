//! MCP / LSP 运行时接入(阶段 3d)。
//!
//! 参照 `ZhuYe/crates/runtime/reflect-exec/src/bootstrap.rs` 的
//! `bootstrap_m6` / `bootstrap_lsp`,但把 lifecycle event 推到 MinimalAgent
//! 的 session broadcast(单一事件通道,前端 dispatcher 按 msg.type 分发)。
//!
//! 设计:
//! - 读 `cfg.mcp_server_configs()` / `cfg.lsp_server_configs()`;
//! - 配置为空或非法 → warn + 跳过(单 server 错不阻塞 agent 启动);
//! - `McpConnectionManager` / `LspConnectionManager` 的 internal lifecycle event
//!   经后台 task 转成 `EventMsg::McpServerStarted/Failed` / `LspServerStarted/Failed`,
//!   通过 `MinimalAgent::subscribe_session` 的 broadcast 反向推送(用 MinimalAgent
//!   暴露的 session_tx 句柄);
//! - MCP 工具按服务追踪注册所有权，避免卸载时误删其他工具;
//! - LSP 单例 `LspTool::new(manager)` 注册。
//!
//! manager 与工具调用通道由 MinimalAgent 持有，供运行时 MCP 管理命令使用。

use std::sync::Arc;

use reflect_config::ReflectConfig;
use reflect_lsp::{LspConnectionManager, LspLifecycleEvent, LspServerConfig, LspTool};
use reflect_mcp::{McpConnectionManager, McpLifecycleEvent, McpServerConfig, McpToolAdapter};
use reflect_protocol::{EVENT_ID_NONE, Event, EventMsg};
use reflect_tools::{ToolRegistry, ToolSource};
use tokio::sync::broadcast;

/// 仅记录每个服务实际注册的工具，避免卸载时误删同名或已替换的工具。
#[derive(Default)]
pub(crate) struct McpTools(
    parking_lot::Mutex<std::collections::HashMap<String, Vec<Arc<dyn reflect_tools::Tool>>>>,
);

impl McpTools {
    fn register(
        &self,
        tools: &ToolRegistry,
        server: &str,
        tool: Arc<dyn reflect_tools::Tool>,
    ) -> bool {
        let name = tool.name().to_string();
        // `with_floor` 变体才会给外部工具套权限 floor；它存入注册表的是
        // 包装后的句柄，因此 ownership 必须记注册表里那份，不能记自己这份。
        if !tools.register_if_absent_with_floor(ToolSource::Runtime, tool.clone()) {
            return false;
        }
        let stored = tools.get(&name).unwrap_or(tool);
        self.0
            .lock()
            .entry(server.to_string())
            .or_default()
            .push(stored);
        true
    }

    fn remove(&self, tools: &ToolRegistry, server: &str) -> Vec<String> {
        let owned = self.0.lock().remove(server).unwrap_or_default();
        owned
            .into_iter()
            .filter_map(|tool| {
                let name = tool.name().to_string();
                // 只删仍然是自己那份的同名工具，不动后来顶替上来的实现。
                tools
                    .get(&name)
                    .is_some_and(|current| Arc::ptr_eq(&current, &tool))
                    .then(|| tools.unregister(&name).then_some(name))
                    .flatten()
            })
            .collect()
    }
}

/// bootstrap MCP servers + 返回 manager 句柄(供热重载)。
///
/// `session_tx` = MinimalAgent 的 session broadcast sender;lifecycle event
/// 经它推给所有前端订阅者。
pub(crate) async fn bootstrap_mcp(
    agent: &crate::state::MinimalAgent,
    cfg: &ReflectConfig,
    tools: Arc<ToolRegistry>,
    session_tx: broadcast::Sender<Event>,
) -> (Arc<McpConnectionManager>, tokio::sync::mpsc::Sender<Event>) {
    let configs = match cfg.mcp_server_configs() {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(error = %e, "MCP config invalid; skipping all MCP servers");
            Vec::new()
        }
    };

    let (internal_tx, internal_rx) = tokio::sync::mpsc::channel::<McpLifecycleEvent>(32);
    let manager = Arc::new(McpConnectionManager::new(internal_tx));

    // MCP 工具调用事件:adapter execute 完成后 emit `McpToolInvoked`
    // (upstream v1.3 起 from_descriptor 需要 event_tx)。mpsc → broadcast
    // 转发,前端按 msg.type 分发即可看到工具调用记录。
    // (clone 必须在 lifecycle forwarder move session_tx 之前。)
    let (invoked_tx, mut invoked_rx) = tokio::sync::mpsc::channel::<Event>(64);
    let invoked_forward = session_tx.clone();
    tokio::spawn(async move {
        while let Some(ev) = invoked_rx.recv().await {
            let _ = invoked_forward.send(ev);
        }
    });

    // 后台 task:internal lifecycle event → protocol Event → session broadcast。
    spawn_mcp_lifecycle_forwarder(internal_rx, session_tx);

    // 并发启动每个 server;每个 task 拿 handle 后注册其 tools。
    for cfg_shape in &configs {
        let mcp_cfg: McpServerConfig = McpServerConfig::from(cfg_shape.clone());
        let mgr = manager.clone();
        let tools_clone = tools.clone();
        let invoked_tx = invoked_tx.clone();
        let inner = agent.inner.clone();
        let expected = cfg.mcp_servers.servers.get(&cfg_shape.name).cloned();
        tokio::spawn(async move {
            let _config = inner.config_write_lock.lock().await;
            if inner.cfg.read().mcp_servers.servers.get(&mcp_cfg.name) != expected.as_ref() {
                return;
            }
            if let Err(error) = start_one_server(
                &mgr,
                &tools_clone,
                &inner.mcp_tools,
                mcp_cfg.clone(),
                Some(invoked_tx),
            )
            .await
            {
                tracing::warn!(server = %mcp_cfg.name, %error, "MCP server failed to start");
            }
        });
    }

    tracing::info!(
        mcp_servers = configs.len(),
        "MCP bootstrap: spawning start tasks"
    );
    (manager, invoked_tx)
}

/// 运行时启动**单个** MCP server 并注册其工具。
///
/// 与 `bootstrap_mcp` 的逐 server 启动路径同款 —— 复用同一个
/// `invoked_tx`,因此 GUI 新增的 server 与启动时的 server 行为一致
/// (工具注册 + 调用事件都进同一通道)。
///
/// 返回注册成功的工具全名列表;启动失败 → `Err(原因)`。
pub(crate) async fn start_one_server(
    manager: &Arc<McpConnectionManager>,
    tools: &Arc<ToolRegistry>,
    ownership: &McpTools,
    cfg: McpServerConfig,
    invoked_tx: Option<tokio::sync::mpsc::Sender<Event>>,
) -> Result<Vec<String>, String> {
    let handle = manager
        .start_server(cfg.clone())
        .await
        .map_err(|e| e.to_string())?;
    let mut names = Vec::new();
    for desc in &handle.tools {
        let adapter = McpToolAdapter::from_descriptor(
            handle.inner.clone(),
            desc,
            &cfg.name,
            cfg.timeout,
            invoked_tx.clone(),
        );
        let arc: Arc<dyn reflect_tools::Tool> = Arc::new(adapter);
        if ownership.register(tools, &cfg.name, arc) {
            names.push(desc.full_name.clone());
        } else {
            tracing::warn!(
                tool = %desc.full_name,
                "MCP tool name collision, skipped"
            );
        }
    }
    Ok(names)
}

/// 运行时停止单个 MCP server 并反注册其工具。
///
/// 返回被反注册的工具全名列表;server 未在跑 → `Ok(vec![])`(幂等)。
pub(crate) async fn stop_one_server(
    manager: &Arc<McpConnectionManager>,
    tools: &Arc<ToolRegistry>,
    ownership: &McpTools,
    name: &str,
) -> Vec<String> {
    let Some(_) = manager.stop_server(name).await else {
        return Vec::new();
    };
    ownership.remove(tools, name)
}

/// bootstrap LSP servers + 返回 manager 句柄。
pub(crate) async fn bootstrap_lsp(
    agent: &crate::state::MinimalAgent,
    cfg: &ReflectConfig,
) -> Result<Option<Arc<LspConnectionManager>>, String> {
    // 幂等:已启用(用户开关)时直接返回现有 manager,不重复注册/起 server。
    if let Some(existing) = agent.inner.lsp_manager.lock().clone() {
        return Ok(Some(existing));
    }
    let tools = agent.tools();
    let session_tx = agent.session_tx();
    let configs = match cfg.lsp_server_configs() {
        Ok(c) if c.is_empty() => {
            return Ok(None);
        }
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(error = %e, "LSP config invalid; skipping all LSP servers");
            return Err(format!("LSP config invalid: {e}"));
        }
    };

    let (internal_tx, mut internal_rx) = tokio::sync::mpsc::channel::<LspLifecycleEvent>(32);
    let manager = Arc::new(LspConnectionManager::new(internal_tx));

    tokio::spawn(async move {
        while let Some(evt) = internal_rx.recv().await {
            let msg = match evt {
                LspLifecycleEvent::Started {
                    server,
                    methods,
                    language_ids,
                } => EventMsg::LspServerStarted(reflect_protocol::LspServerStartedEvent {
                    server,
                    methods,
                    language_ids,
                }),
                LspLifecycleEvent::Failed {
                    server,
                    error,
                    will_retry,
                } => EventMsg::LspServerFailed(reflect_protocol::LspServerFailedEvent {
                    server,
                    error,
                    will_retry,
                }),
                LspLifecycleEvent::Stopped { server: _ } => continue,
            };
            let _ = session_tx.send(Event::new(EVENT_ID_NONE, msg));
        }
    });

    // 单例 LspTool(单一 `lsp` tool,按 file_path 路由到对应 server)。
    // 常驻 manager 存进 MinimalAgent,供开关命令启停与文件预热。
    *agent.inner.lsp_manager.lock() = Some(manager.clone());
    let tool = Arc::new(LspTool::new(manager.clone()));
    tools.register_with_source(ToolSource::Runtime, tool);

    for cfg_shape in &configs {
        let lsp_cfg: LspServerConfig = match cfg_shape.clone().try_into() {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!(error = %e, "LSP config shape→strong-type conversion failed");
                continue;
            }
        };
        let mgr = manager.clone();
        tokio::spawn(async move {
            if let Err(e) = mgr.start_server(lsp_cfg).await {
                tracing::warn!(error = %e, "LSP server failed to start");
            }
        });
    }

    tracing::info!(
        lsp_servers = configs.len(),
        "LSP bootstrap: spawning start tasks"
    );
    Ok(Some(manager))
}

/// 把 reflect_mcp 的 transport kind 映射成 protocol 的 mirror 枚举。
fn transport_mirror(transport: reflect_mcp::McpTransport) -> reflect_protocol::McpTransportMirror {
    match transport {
        reflect_mcp::McpTransport::Stdio => reflect_protocol::McpTransportMirror::Stdio,
        reflect_mcp::McpTransport::Http => reflect_protocol::McpTransportMirror::Http,
        reflect_mcp::McpTransport::Sse => reflect_protocol::McpTransportMirror::Sse,
    }
}

/// 把 `McpConnectionManager` 的 internal lifecycle event 流转成协议事件推
/// session broadcast(Started / Failed;Stopped 静默)。用户 MCP
/// (`bootstrap_mcp`)与插件 MCP(`state/plugins.rs` 挂载级 manager)共用
/// 同一转换,前端按 `msg.type` 分发即可见两类 server 的启动/失败。
pub(crate) fn spawn_mcp_lifecycle_forwarder(
    mut internal_rx: tokio::sync::mpsc::Receiver<McpLifecycleEvent>,
    session_tx: broadcast::Sender<Event>,
) {
    tokio::spawn(async move {
        while let Some(evt) = internal_rx.recv().await {
            let msg = match evt {
                McpLifecycleEvent::Started {
                    server,
                    tools,
                    tool_names,
                    transport,
                } => EventMsg::McpServerStarted(reflect_protocol::McpServerStartedEvent {
                    server,
                    tool_count: tools,
                    tool_names,
                    transport: transport_mirror(transport),
                }),
                McpLifecycleEvent::Failed {
                    server,
                    error,
                    will_retry,
                } => EventMsg::McpServerFailed(reflect_protocol::McpServerFailedEvent {
                    server,
                    error,
                    will_retry,
                }),
                McpLifecycleEvent::Stopped { server: _ } => continue,
            };
            let _ = session_tx.send(Event::new(EVENT_ID_NONE, msg));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestTool(&'static str);
    #[async_trait::async_trait]
    impl reflect_tools::Tool for TestTool {
        fn name(&self) -> &str {
            self.0
        }
        fn description(&self) -> &str {
            "test"
        }
        fn parameters_schema(&self) -> serde_json::Value {
            serde_json::json!({"type": "object"})
        }
        async fn execute(
            &self,
            _: reflect_tools::ToolContext,
            _: serde_json::Value,
        ) -> Result<reflect_protocol::ToolOutput, reflect_tools::ToolError> {
            unreachable!()
        }
    }

    #[test]
    fn stopping_server_preserves_colliding_and_replaced_tools() {
        let tools = ToolRegistry::new();
        let owned = McpTools::default();
        tools.register(Arc::new(TestTool("collision")));
        assert!(!owned.register(&tools, "server", Arc::new(TestTool("collision"))));
        assert!(owned.register(&tools, "server", Arc::new(TestTool("replaced"))));
        assert!(owned.register(&tools, "server", Arc::new(TestTool("original"))));
        tools.register(Arc::new(TestTool("replaced")));
        assert_eq!(owned.remove(&tools, "server"), vec!["original"]);
        assert!(tools.get("collision").is_some());
        assert!(tools.get("replaced").is_some());
        assert!(tools.get("original").is_none());
    }

    fn server_config(name: &str) -> ReflectConfig {
        reflect_config::load_from_str(&format!(
            "[mcp_servers.{name}]\ntype = \"stdio\"\ncommand = \"/nonexistent/reflect-mcp-test\"\n"
        ))
        .unwrap()
    }

    #[tokio::test]
    async fn empty_bootstrap_keeps_lifecycle_channel_for_later_servers() {
        let agent = crate::state::MinimalAgent::new_empty();
        let mut events = agent.subscribe_session();
        let (manager, invoked) = bootstrap_mcp(
            &agent,
            &ReflectConfig::default(),
            agent.tools(),
            agent.session_tx(),
        )
        .await;
        invoked
            .send(Event::new(
                "mcp-invocation-probe",
                EventMsg::ShutdownComplete,
            ))
            .await
            .unwrap();
        let forwarded = tokio::time::timeout(std::time::Duration::from_secs(2), events.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(forwarded.id, "mcp-invocation-probe");
        let shape = server_config("later")
            .mcp_server_configs()
            .unwrap()
            .remove(0);
        assert!(
            start_one_server(
                &manager,
                &agent.tools(),
                &agent.inner.mcp_tools,
                shape.into(),
                Some(invoked)
            )
            .await
            .is_err()
        );
        let event = tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                let event = events.recv().await.unwrap();
                if matches!(&event.msg, EventMsg::McpServerFailed(info) if info.server == "later") {
                    break event;
                }
            }
        })
        .await
        .unwrap();
        assert_eq!(event.id, EVENT_ID_NONE);
    }

    #[tokio::test]
    async fn queued_bootstrap_ignores_server_removed_before_start() {
        let agent = crate::state::MinimalAgent::new_empty();
        let config = server_config("stale");
        *agent.inner.cfg.write() = config.clone();
        let mut events = agent.subscribe_session();
        let guard = agent.inner.config_write_lock.lock().await;
        let (_manager, _invoked) =
            bootstrap_mcp(&agent, &config, agent.tools(), agent.session_tx()).await;
        *agent.inner.cfg.write() = ReflectConfig::default();
        drop(guard);
        let event =
            tokio::time::timeout(std::time::Duration::from_millis(150), events.recv()).await;
        assert!(
            event.is_err(),
            "removed server should not start or emit a failure"
        );
    }
}
