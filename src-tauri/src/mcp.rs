//! MCP / LSP 运行时接入(阶段 3d)。
//!
//! 参照 `Reflect-Agent/crates/runtime/reflect-exec/src/bootstrap.rs` 的
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
//! - MCP 工具逐个 `register_if_absent(ToolSource::Runtime, McpToolAdapter)`;
//! - LSP 单例 `LspTool::new(manager)` 注册。
//!
//! 注意:**返回 manager Arc 给 MinimalAgent 持有**,供后续 config 热重载的
//! diff 重启用(reload task 在阶段 4 接入)。

use std::sync::{Arc, OnceLock};

use reflect_config::ReflectConfig;
use reflect_lsp::{LspConnectionManager, LspLifecycleEvent, LspServerConfig, LspTool};
use reflect_mcp::{McpConnectionManager, McpLifecycleEvent, McpServerConfig, McpToolAdapter};
use reflect_protocol::{EVENT_ID_NONE, Event, EventMsg};
use reflect_tools::{ToolRegistry, ToolSource};
use tokio::sync::broadcast;

/// MCP 工具调用事件通道(进程级单例,mpsc)。
///
/// `bootstrap_mcp` 建好后存这里,供 GUI **运行时新增** server 复用 ——
/// 否则新增的 server 发的工具调用事件不会进 session broadcast,前端看不到。
static MCP_INVOKED_TX: OnceLock<tokio::sync::mpsc::Sender<Event>> = OnceLock::new();

/// bootstrap MCP servers + 返回 manager 句柄(供热重载)。
///
/// `session_tx` = MinimalAgent 的 session broadcast sender;lifecycle event
/// 经它推给所有前端订阅者。
pub(crate) async fn bootstrap_mcp(
    cfg: &ReflectConfig,
    tools: Arc<ToolRegistry>,
    session_tx: broadcast::Sender<Event>,
) -> Option<Arc<McpConnectionManager>> {
    let configs = match cfg.mcp_server_configs() {
        Ok(c) if c.is_empty() => return None,
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(error = %e, "MCP config invalid; skipping all MCP servers");
            return None;
        }
    };

    let (internal_tx, internal_rx) = tokio::sync::mpsc::channel::<McpLifecycleEvent>(32);
    let manager = Arc::new(McpConnectionManager::new(internal_tx));

    // MCP 工具调用事件:adapter execute 完成后 emit `McpToolInvoked`
    // (upstream v1.3 起 from_descriptor 需要 event_tx)。mpsc → broadcast
    // 转发,前端按 msg.type 分发即可看到工具调用记录。
    // (clone 必须在 lifecycle forwarder move session_tx 之前。)
    let (invoked_tx, mut invoked_rx) = tokio::sync::mpsc::channel::<Event>(64);
    // 存进进程级单例:GUI 运行时新增 server 时复用同一通道(否则新增 server
    // 的工具调用事件不会进 session broadcast)。
    let _ = MCP_INVOKED_TX.set(invoked_tx.clone());
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
        tokio::spawn(async move {
            match mgr.start_server(mcp_cfg.clone()).await {
                Ok(handle) => {
                    for desc in &handle.tools {
                        let adapter = McpToolAdapter::from_descriptor(
                            handle.inner.clone(),
                            desc,
                            &mcp_cfg.name,
                            mcp_cfg.timeout,
                            Some(invoked_tx.clone()),
                        );
                        let arc: Arc<dyn reflect_tools::Tool> = Arc::new(adapter);
                        if !tools_clone.register_if_absent(ToolSource::Runtime, arc) {
                            tracing::warn!(
                                tool = %desc.full_name,
                                "MCP tool name collision, skipped"
                            );
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        server = %mcp_cfg.name,
                        error = %e,
                        "MCP server failed to start"
                    );
                }
            }
        });
    }

    tracing::info!(
        mcp_servers = configs.len(),
        "MCP bootstrap: spawning start tasks"
    );
    Some(manager)
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
    cfg: McpServerConfig,
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
            MCP_INVOKED_TX.get().cloned(),
        );
        let arc: Arc<dyn reflect_tools::Tool> = Arc::new(adapter);
        if tools.register_if_absent(ToolSource::Runtime, arc) {
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
    name: &str,
) -> Vec<String> {
    let Some(tool_names) = manager.stop_server(name).await else {
        return Vec::new();
    };
    for tool_name in &tool_names {
        tools.unregister(tool_name);
    }
    tool_names
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
