//! MCP 运行时接入(阶段 3d)。
//!
//! 参照 `ZhuYe/crates/runtime/zhuye-exec/src/bootstrap.rs` 的 `bootstrap_m6`,
//! 但把 lifecycle event 推到 MinimalAgent 的 session broadcast(单一事件通道,
//! 前端 dispatcher 按 msg.type 分发)。LSP 同期接入在 `lsp_runtime.rs`
//! (为守 500 行文件预算拆出),工具注册所有权在 `mcp_tools.rs`。
//!
//! 设计:
//! - 读 `cfg.mcp_server_configs()`;
//! - 配置为空或非法 → warn + 跳过(单 server 错不阻塞 agent 启动);
//! - `McpConnectionManager` 的 internal lifecycle event 经后台 task 转成
//!   `EventMsg::McpServerStarted/Failed` / `McpElicitation` / ToolsChanged
//!   注册表同步,通过 `MinimalAgent::subscribe_session` 的 broadcast 反向
//!   推送(用 MinimalAgent 暴露的 session_tx 句柄);
//! - MCP 工具按服务追踪注册所有权(`mcp_tools::McpTools`),避免卸载 /
//!   清单刷新时误删其他工具。
//!
//! manager 与工具调用通道由 MinimalAgent 持有，供运行时 MCP 管理命令使用。

use std::collections::HashSet;
use std::sync::Arc;

use tokio::sync::broadcast;
use zhuye_config::ZhuyeConfig;
use zhuye_mcp::{McpConnectionManager, McpLifecycleEvent, McpServerConfig, McpToolAdapter};
use zhuye_protocol::{EVENT_ID_NONE, Event, EventMsg, McpElicitationResponse};
use zhuye_tools::{McpElicitationWaiters, ToolRegistry};

pub(crate) use crate::mcp_tools::McpTools;

/// bootstrap MCP servers + 返回 manager 句柄(供热重载)。
///
/// `session_tx` = MinimalAgent 的 session broadcast sender;lifecycle event
/// 经它推给所有前端订阅者。
pub(crate) async fn bootstrap_mcp(
    agent: &crate::state::MinimalAgent,
    cfg: &ZhuyeConfig,
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
    // elicitation 等待表 + ToolsChanged 注册表同步挂在用户 MCP 路径上。
    spawn_mcp_lifecycle_forwarder(
        internal_rx,
        session_tx,
        McpLifecycleDeps {
            elicitations: agent.inner.mcp_elicitations.lock().clone(),
            tools: Some(McpToolsSync {
                registry: tools.clone(),
                ownership: agent.inner.mcp_tools.clone(),
                manager: manager.clone(),
                invoked_tx: Some(invoked_tx.clone()),
            }),
        },
    );

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
        let arc: Arc<dyn zhuye_tools::Tool> = Arc::new(adapter);
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

/// 把 zhuye_mcp 的 transport kind 映射成 protocol 的 mirror 枚举。
fn transport_mirror(transport: zhuye_mcp::McpTransport) -> zhuye_protocol::McpTransportMirror {
    match transport {
        zhuye_mcp::McpTransport::Stdio => zhuye_protocol::McpTransportMirror::Stdio,
        zhuye_mcp::McpTransport::Http => zhuye_protocol::McpTransportMirror::Http,
        zhuye_mcp::McpTransport::Sse => zhuye_protocol::McpTransportMirror::Sse,
    }
}

/// lifecycle 转发器的宿主侧依赖(exec bootstrap 同款约定)。
pub(crate) struct McpLifecycleDeps {
    /// 会话级 MCP elicitation 回执等待表。**必须**与线程
    /// `AgentConfig.approval_context.mcp_elicitations` 是同一张
    /// (thread_factory 装配),否则 `Op::McpElicitationResponse` 的回执
    /// 路由不到 waiter,rmcp 请求只能等 TTL。
    pub(crate) elicitations: McpElicitationWaiters,
    /// ToolsChanged 的注册表同步上下文。插件挂载级 manager 的工具不经
    /// `ToolRegistry`,传 `None` —— 清单刷新只记日志。
    pub(crate) tools: Option<McpToolsSync>,
}

/// ToolsChanged 注册表同步所需的一组句柄(用户 MCP 路径专用)。
pub(crate) struct McpToolsSync {
    registry: Arc<ToolRegistry>,
    ownership: Arc<McpTools>,
    manager: Arc<McpConnectionManager>,
    invoked_tx: Option<tokio::sync::mpsc::Sender<Event>>,
}

/// 把 `McpConnectionManager` 的 internal lifecycle event 流转成协议事件推
/// session broadcast(Started / Failed;Stopped 静默;Elicitation 登记
/// waiter 后透传;ToolsChanged 同步注册表)。用户 MCP(`bootstrap_mcp`)
/// 与插件 MCP(`state/plugins.rs` 挂载级 manager)共用同一转换,前端按
/// `msg.type` 分发即可见两类 server 的启动/失败。
pub(crate) fn spawn_mcp_lifecycle_forwarder(
    mut internal_rx: tokio::sync::mpsc::Receiver<McpLifecycleEvent>,
    session_tx: broadcast::Sender<Event>,
    deps: McpLifecycleDeps,
) {
    tokio::spawn(async move {
        while let Some(evt) = internal_rx.recv().await {
            let msg = match evt {
                McpLifecycleEvent::Started {
                    server,
                    tools,
                    tool_names,
                    transport,
                } => EventMsg::McpServerStarted(zhuye_protocol::McpServerStartedEvent {
                    server,
                    tool_count: tools,
                    tool_names,
                    transport: transport_mirror(transport),
                }),
                McpLifecycleEvent::Failed {
                    server,
                    error,
                    will_retry,
                } => EventMsg::McpServerFailed(zhuye_protocol::McpServerFailedEvent {
                    server,
                    error,
                    will_retry,
                }),
                McpLifecycleEvent::Stopped { server: _ } => continue,
                McpLifecycleEvent::Elicitation { event, respond } => {
                    // 顺序关键(与 exec bootstrap 同款):先登记 waiter 再发
                    // 事件 —— 反过来的话宿主可能在登记完成前就回执,回执被
                    // 引擎按「无对应 waiter」丢弃,rmcp 请求只能等 TTL。
                    let request_id = event.request_id.clone();
                    deps.elicitations.lock().insert(request_id.clone(), respond);
                    let ev = Event::new(EVENT_ID_NONE, EventMsg::McpElicitation(event));
                    if session_tx.send(ev).is_err() {
                        // broadcast 已无订阅者(会话退出 / 前端重载窗口):
                        // 立即按 cancel 了结,不等 TTL。不 break —— 订阅者
                        // 回来后后续 lifecycle 事件还要继续转发。
                        if let Some(tx) = deps.elicitations.lock().remove(&request_id) {
                            let _ = tx.send(McpElicitationResponse {
                                id: request_id,
                                action: "cancel".into(),
                                content: None,
                            });
                        }
                    }
                    continue;
                }
                McpLifecycleEvent::ToolsChanged { server, tools } => {
                    // 服务端主动改了工具清单:反注册消失的、注册新增的。
                    // 注册表是 LLM 可见面的唯一真相 —— 不同步就会让模型
                    // 看见已下线的工具(调用报错)或看不见新工具。
                    let Some(sync) = &deps.tools else {
                        tracing::debug!(
                            server = %server,
                            count = tools.len(),
                            "插件 MCP 工具清单刷新(工具不经注册表,跳过同步)"
                        );
                        continue;
                    };
                    let new_names: HashSet<String> =
                        tools.iter().map(|d| d.full_name.clone()).collect();
                    let removed = sync
                        .ownership
                        .remove_except(&sync.registry, &server, &new_names);
                    // 新增工具必须绑到该 server 的**活连接**上(不是新建 peer);
                    // 已在册的名字 register_if_absent 会跳过(含被顶替实现)。
                    let Some((client, timeout)) = sync.manager.server_client(&server).await else {
                        tracing::warn!(server = %server, "工具清单刷新时找不到活连接,跳过注册");
                        continue;
                    };
                    for descriptor in &tools {
                        if sync.registry.get(&descriptor.full_name).is_some() {
                            continue;
                        }
                        let adapter = McpToolAdapter::from_descriptor(
                            client.clone(),
                            descriptor,
                            &server,
                            timeout,
                            sync.invoked_tx.clone(),
                        );
                        sync.ownership
                            .register(&sync.registry, &server, Arc::new(adapter));
                    }
                    tracing::info!(
                        server = %server,
                        current = tools.len(),
                        removed = removed.len(),
                        "MCP 工具清单已刷新"
                    );
                    continue;
                }
            };
            let _ = session_tx.send(Event::new(EVENT_ID_NONE, msg));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server_config(name: &str) -> ZhuyeConfig {
        zhuye_config::load_from_str(&format!(
            "[mcp_servers.{name}]\ntype = \"stdio\"\ncommand = \"/nonexistent/zhuye-mcp-test\"\n"
        ))
        .unwrap()
    }

    #[tokio::test]
    async fn empty_bootstrap_keeps_lifecycle_channel_for_later_servers() {
        let agent = crate::state::MinimalAgent::new_empty();
        let mut events = agent.subscribe_session();
        let (manager, invoked) = bootstrap_mcp(
            &agent,
            &ZhuyeConfig::default(),
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
        *agent.inner.cfg.write() = ZhuyeConfig::default();
        drop(guard);
        let event =
            tokio::time::timeout(std::time::Duration::from_millis(150), events.recv()).await;
        assert!(
            event.is_err(),
            "removed server should not start or emit a failure"
        );
    }
}
