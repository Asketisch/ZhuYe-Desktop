//! LSP 运行时接入(阶段 3d)。
//!
//! 参照 `ZhuYe/crates/runtime/zhuye-exec/src/bootstrap.rs` 的 `bootstrap_lsp`,
//! 把 lifecycle event 推到 MinimalAgent 的 session broadcast(单一事件通道,
//! 前端 dispatcher 按 msg.type 分发)。原与 MCP 同栖 `mcp.rs`,为守 500 行
//! 文件预算拆出 —— 两者职责独立:LSP 按工作区手动开启,MCP 安装即启动。

use std::sync::Arc;

use zhuye_config::ReflectConfig;
use zhuye_lsp::{LspConnectionManager, LspLifecycleEvent, LspServerConfig, LspTool};
use zhuye_protocol::{EVENT_ID_NONE, Event, EventMsg};
use zhuye_tools::ToolSource;

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

    let inner_for_events = Arc::downgrade(&agent.inner);
    let manager_for_events = Arc::downgrade(&manager);
    tokio::spawn(async move {
        while let Some(evt) = internal_rx.recv().await {
            let msg = match evt {
                LspLifecycleEvent::Started {
                    server,
                    methods,
                    language_ids,
                } => EventMsg::LspServerStarted(zhuye_protocol::LspServerStartedEvent {
                    server,
                    methods,
                    language_ids,
                }),
                LspLifecycleEvent::Failed {
                    server,
                    error,
                    will_retry,
                } => EventMsg::LspServerFailed(zhuye_protocol::LspServerFailedEvent {
                    server,
                    error,
                    will_retry,
                }),
                LspLifecycleEvent::Stopped { server: _ } => continue,
            };
            let (Some(inner), Some(owner)) =
                (inner_for_events.upgrade(), manager_for_events.upgrade())
            else {
                break;
            };
            // 持锁到广播完成：关闭或替换管理器后，旧实例的事件不能污染界面。
            let current = inner.lsp_manager.lock();
            if current.as_ref().is_some_and(|m| Arc::ptr_eq(m, &owner)) {
                let _ = session_tx.send(Event::new(EVENT_ID_NONE, msg));
            }
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
        let inner = Arc::downgrade(&agent.inner);
        tokio::spawn(async move {
            let name = lsp_cfg.name.clone();
            let result = mgr.start_server(lsp_cfg).await;
            let still_current = inner.upgrade().is_some_and(|inner| {
                inner
                    .lsp_manager
                    .lock()
                    .as_ref()
                    .is_some_and(|m| Arc::ptr_eq(m, &mgr))
            });
            if !still_current {
                // 握手期间已关闭或重开：成功启动的旧子进程必须关闭。
                if result.is_ok() {
                    mgr.stop_server(&name).await;
                }
            } else {
                match result {
                    Err(e) => tracing::warn!(error = %e, "LSP server failed to start"),
                    Ok(handle) => {
                        handle.client.peer.cancel.cancelled().await;
                        // A normal shutdown removes the handle before cancelling the peer.
                        // Only an unexpected disconnect leaves it in the manager.
                        if mgr.server_names().await.contains(&name) {
                            mgr.stop_server(&name).await;
                            if let Some(inner) = inner.upgrade() {
                                let current = inner.lsp_manager.lock();
                                if current.as_ref().is_some_and(|m| Arc::ptr_eq(m, &mgr)) {
                                    let _ = inner.session_tx.send(Event::new(
                                        EVENT_ID_NONE,
                                        EventMsg::LspServerFailed(
                                            zhuye_protocol::LspServerFailedEvent {
                                                server: name,
                                                error: "LSP server disconnected".into(),
                                                will_retry: false,
                                            },
                                        ),
                                    ));
                                }
                            }
                        }
                    }
                }
            }
        });
    }

    tracing::info!(
        lsp_servers = configs.len(),
        "LSP bootstrap: spawning start tasks"
    );
    Ok(Some(manager))
}
