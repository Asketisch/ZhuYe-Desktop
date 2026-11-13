//! MCP 服务管理命令面 —— 让「加一个 MCP server」不再需要手改 TOML。
//!
//! 此前 GUI 只能**观测** MCP(`mcp_server_started` / `failed` 事件 + 状态
//! 点),加服务得手改 `config.toml` 的 `[mcp_servers.<name>]` —— MCP 是
//! 基座最主要的扩展机制,却没有任何自助路径。
//!
//! 写路径:改内存里的 `ReflectConfig.mcp_servers` → 落盘
//! (`~/.zhuye/config.toml`)→ 运行时起/停对应 server(注册/反注册其
//! 工具)。与启动时的 `bootstrap_mcp` 同款语义(`mcp::start_one_server` /
//! `stop_one_server`)。
//!
//! 精选 catalog(内置离线清单 + 安装提示)经核心的
//! `reflect_mcp::registry` 暴露 —— 解决「我不知道能装哪些 MCP」。

use std::collections::BTreeMap;

use reflect_config::{McpServerEntry, McpTransport, ReflectConfig};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::error::{CommandError, CommandResult};
use crate::state::MinimalAgent;

/// 一个已配置的 MCP server(camelCase 出线)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInfo {
    /// server 名(`[mcp_servers.<name>]` 的键)。
    pub name: String,
    /// transport:`stdio` / `http` / `sse`。
    pub transport: String,
    /// stdio 启动命令。
    pub command: Option<String>,
    /// stdio 启动参数。
    pub args: Vec<String>,
    /// http / sse 地址。
    pub url: Option<String>,
    /// 当前是否在运行(manager 里的活跃 server)。
    pub running: bool,
}

/// 精选 catalog 条目(camelCase 出线)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpCatalogEntry {
    /// 稳定 id(写配置时用的键)。
    pub id: String,
    /// 展示名。
    pub name: String,
    /// 一句话说明。
    pub description: String,
    /// 分类。
    pub category: String,
    /// stdio 启动命令。
    pub command: String,
    /// stdio 启动参数。
    pub args: Vec<String>,
    /// 安装提示(核心给的,含 npm 包名等)。
    pub install_hint: String,
}

/// 列出配置中的全部 MCP server + 运行状态。
#[tauri::command]
pub async fn reflect_list_mcp_servers(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<Vec<McpServerInfo>> {
    let cfg = agent.inner.cfg.read().clone();
    // 先 clone 出 manager 再 await —— 锁守卫不能跨 await(否则 future 非 Send)。
    let mgr = agent.inner.mcp_manager.lock().clone();
    let running: Vec<String> = match mgr {
        Some(m) => m.server_names().await,
        None => Vec::new(),
    };
    let mut out: Vec<McpServerInfo> = cfg
        .mcp_servers
        .servers
        .iter()
        .map(|(name, entry)| McpServerInfo {
            name: name.clone(),
            transport: transport_str(entry.transport).to_string(),
            command: entry.command.clone(),
            args: entry.args.clone().unwrap_or_default(),
            url: entry.url.clone(),
            running: running.iter().any(|r| r == name),
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// 列出内置精选 MCP catalog(离线清单 + 安装提示)。
#[tauri::command]
pub async fn reflect_mcp_catalog() -> CommandResult<Vec<McpCatalogEntry>> {
    Ok(reflect_mcp::registry::curated_catalog()
        .into_iter()
        .map(|e| {
            let hint = reflect_mcp::registry::install_hint(&e);
            McpCatalogEntry {
                id: e.id,
                name: e.name,
                description: e.description,
                category: e.category,
                command: e.command,
                args: e.args,
                install_hint: hint,
            }
        })
        .collect())
}

/// 新增或更新一个 MCP server:落盘配置 + 运行时起/停。
///
/// 运行时语义:
/// - 新增 → `start_server` + 注册其工具(失败只记事件,命令仍成功 ——
///   server 起不来是运行期问题,配置已落盘);
/// - 更新 → 先停旧 server(反注册旧工具)再起新的;
/// - 删除 → 停 server + 反注册工具。
#[tauri::command]
pub async fn reflect_upsert_mcp_server(
    agent: State<'_, MinimalAgent>,
    name: String,
    entry: McpServerEntry,
) -> CommandResult<()> {
    validate_name(&name)?;
    let _config_write = agent.inner.config_write_lock.lock().await;
    let mut cfg = agent.inner.cfg.read().clone();
    let existed = cfg.mcp_servers.servers.contains_key(&name);
    cfg.mcp_servers.servers.insert(name.clone(), entry);

    // 编译成强类型 shape(校验 command / url 等必填)—— 编译失败**不落盘**,
    // 避免写出非法配置。编译路径与启动时完全一致(`mcp_server_configs()`)。
    let shapes = cfg.mcp_server_configs().map_err(|e| CommandError {
        msg: format!("invalid MCP server config: {e}"),
    })?;
    let shape = shapes
        .into_iter()
        .find(|s| s.name == name)
        .ok_or_else(|| CommandError {
            msg: format!("MCP server {name} not found after insert"),
        })?;
    let mcp_cfg = reflect_mcp::McpServerConfig::from(shape);

    // 落盘(共享 persist_config:写盘 + 换内存快照)。
    crate::commands::config::persist_config(&agent, cfg)?;

    // 运行时:更新 = 先停旧的再起新的;新增 = 直接起。
    let mgr = agent.inner.mcp_manager.lock().clone();
    if let Some(mgr) = mgr {
        let tools = agent.tools();
        if existed {
            crate::mcp::stop_one_server(&mgr, &tools, &agent.inner.mcp_tools, &name).await;
        }
        let invoked_tx = agent.inner.mcp_invoked_tx.lock().clone();
        match crate::mcp::start_one_server(
            &mgr,
            &tools,
            &agent.inner.mcp_tools,
            mcp_cfg,
            invoked_tx,
        )
        .await
        {
            Ok(names) => {
                tracing::info!(server = %name, tools = names.len(), "MCP server started (GUI)")
            }
            Err(e) => {
                tracing::warn!(server = %name, error = %e, "MCP server failed to start (GUI)")
            }
        }
    }
    Ok(())
}

/// 删除一个 MCP server:落盘配置 + 运行时停服。
#[tauri::command]
pub async fn reflect_delete_mcp_server(
    agent: State<'_, MinimalAgent>,
    name: String,
) -> CommandResult<()> {
    let _config_write = agent.inner.config_write_lock.lock().await;
    let mut cfg = agent.inner.cfg.read().clone();
    if cfg.mcp_servers.servers.remove(&name).is_none() {
        // 未配置 → 幂等成功(前端不用区分「本来就没有」)。
        return Ok(());
    }
    crate::commands::config::persist_config(&agent, cfg)?;

    let mgr = agent.inner.mcp_manager.lock().clone();
    if let Some(mgr) = mgr {
        let tools = agent.tools();
        let removed =
            crate::mcp::stop_one_server(&mgr, &tools, &agent.inner.mcp_tools, &name).await;
        tracing::info!(server = %name, tools = removed.len(), "MCP server stopped (GUI)");
    }
    Ok(())
}

/// 一个 MCP 资源(camelCase 出线)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpResourceInfo {
    /// 暴露该资源的 server 名。
    pub server: String,
    /// 资源名。
    pub name: String,
    /// 资源 URI。
    pub uri: String,
    /// 资源描述(可选)。
    pub description: Option<String>,
    /// MIME 类型(可选)。
    pub mime_type: Option<String>,
}

/// 一个 MCP prompt(camelCase 出线)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpPromptInfo {
    /// 暴露该 prompt 的 server 名。
    pub server: String,
    /// prompt 名。
    pub name: String,
    /// 说明(可选)。
    pub description: Option<String>,
    /// 参数名列表。
    pub arguments: Vec<String>,
}

/// 列出所有 MCP server 暴露的**资源**。
///
/// MCP 三大原语里此前只有 tools 对用户可达 —— resources / prompts 只能被
/// LLM 调用,用户想复用某个 server 的资源或 prompt 模板时没有路径。
/// 本命令直接问 rmcp peer(`list_all_resources()`),与核心的
/// `ListMcpResourcesTool` 同源。
#[tauri::command]
pub async fn reflect_list_mcp_resources(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<Vec<McpResourceInfo>> {
    let mgr = agent.inner.mcp_manager.lock().clone();
    let Some(mgr) = mgr else {
        return Ok(Vec::new());
    };
    let peers = mgr.server_peers().await;
    let mut out: Vec<McpResourceInfo> = Vec::new();
    for (server, peer) in peers {
        match peer.list_all_resources().await {
            Ok(resources) => {
                for r in resources {
                    out.push(McpResourceInfo {
                        server: server.clone(),
                        name: r.name.clone(),
                        uri: r.uri.clone(),
                        description: r.description.clone(),
                        mime_type: r.mime_type.clone(),
                    });
                }
            }
            Err(e) => {
                tracing::warn!(server = %server, error = %e, "列举 MCP 资源失败");
            }
        }
    }
    out.sort_by(|a, b| (&a.server, &a.name).cmp(&(&b.server, &b.name)));
    Ok(out)
}

/// 列出所有 MCP server 暴露的 **prompt** 模板(与核心
/// `ListMcpPromptsTool` 同源)。
#[tauri::command]
pub async fn reflect_list_mcp_prompts(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<Vec<McpPromptInfo>> {
    let mgr = agent.inner.mcp_manager.lock().clone();
    let Some(mgr) = mgr else {
        return Ok(Vec::new());
    };
    let peers = mgr.server_peers().await;
    let mut out: Vec<McpPromptInfo> = Vec::new();
    for (server, peer) in peers {
        match peer.list_all_prompts().await {
            Ok(prompts) => {
                for p in prompts {
                    out.push(McpPromptInfo {
                        server: server.clone(),
                        name: p.name.clone(),
                        description: p.description.clone(),
                        arguments: p
                            .arguments
                            .as_ref()
                            .map(|args| args.iter().map(|a| a.name.clone()).collect())
                            .unwrap_or_default(),
                    });
                }
            }
            Err(e) => {
                tracing::warn!(server = %server, error = %e, "列举 MCP prompts 失败");
            }
        }
    }
    out.sort_by(|a, b| (&a.server, &a.name).cmp(&(&b.server, &b.name)));
    Ok(out)
}

/// transport 枚举 → 线格式字符串。
fn transport_str(t: McpTransport) -> &'static str {
    match t {
        McpTransport::Stdio => "stdio",
        McpTransport::Http => "http",
        McpTransport::Sse => "sse",
    }
}

/// 校验 server 名(会进配置表的键)。
fn validate_name(name: &str) -> CommandResult<()> {
    if name.trim().is_empty() {
        return Err(CommandError {
            msg: "MCP server name cannot be empty".into(),
        });
    }
    if name.contains('/') || name.contains('\\') || name.contains('\0') || name == ".." {
        return Err(CommandError {
            msg: format!("MCP server name contains invalid characters: {name:?}"),
        });
    }
    Ok(())
}

/// 便捷:把 `[mcp_servers]` 表读成有序 map(给内部测试用)。
#[allow(dead_code)]
pub(crate) fn servers_table(cfg: &ReflectConfig) -> BTreeMap<String, McpServerEntry> {
    cfg.mcp_servers.servers.clone().into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_name_rejects_traversal() {
        assert!(validate_name("ok-name").is_ok());
        assert!(validate_name("").is_err());
        assert!(validate_name("a/b").is_err());
        assert!(validate_name("a\\b").is_err());
        assert!(validate_name("..").is_err());
    }

    #[test]
    fn transport_strings_match_config_serde() {
        // 线格式必须与配置里的 `type = "stdio" | "http" | "sse"` 一致。
        assert_eq!(transport_str(McpTransport::Stdio), "stdio");
        assert_eq!(transport_str(McpTransport::Http), "http");
        assert_eq!(transport_str(McpTransport::Sse), "sse");
    }
}
