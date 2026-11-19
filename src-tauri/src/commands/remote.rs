//! 远程模式命令 — Tailscale + iOS / 远端 daemon 接入控制。
//!
//! Phase 2 第 2 项。本轮实现:
//! - 远程配置 CRUD（host / port / auth_token / auto_connect）
//! - tailscale status 探测(shell out `tailscale status --json=true`)
//! - tailscale daemon command preview(iOS 配置页面给用户看的 hint 字符串)
//!
//! 不实现(诚实 scope):
//! - 独立 TCP JSON-RPC 守护进程二进制(`codex_monitor_daemon` 作为参考):
//!   需要独立 workspace + cross-compile + iOS 配对 token 协议,远超本轮 scope。
//!   IPC 接口先就位,driver 留作后续。
//! - 自动 connect / 自动 start daemon on launch:同样依赖上述 binary。

use reflect_app_core::tailscale::{self, TailscaleStatus};
use serde::Serialize;
use tauri::State;

use crate::commands::error::{CommandError, CommandResult};
use crate::state::{MinimalAgent, RemoteConfig, RemoteStatus};

/// `reflect_get_tailscale_status` 返回值(直接用 app-core 类型)。
pub type ReflectTailscaleStatus = TailscaleStatus;

/// `reflect_get_remote_config` 返回值。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteConfigSnapshot {
    pub host: String,
    pub port: u16,
    pub auth_token: Option<String>,
    pub auto_connect: bool,
    pub endpoint: String,
    pub is_ready: bool,
}

impl From<&RemoteConfig> for RemoteConfigSnapshot {
    fn from(cfg: &RemoteConfig) -> Self {
        Self {
            host: cfg.host.clone(),
            port: cfg.port,
            auth_token: cfg.auth_token.clone(),
            auto_connect: cfg.auto_connect,
            endpoint: cfg.endpoint(),
            is_ready: cfg.is_ready(),
        }
    }
}

/// 读取当前 remote config。
#[tauri::command]
pub async fn reflect_get_remote_config(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<RemoteConfigSnapshot> {
    Ok(RemoteConfigSnapshot::from(&agent.remote_config()))
}

/// 覆盖式写入 remote config。返回更新后的 snapshot。
#[tauri::command]
pub async fn reflect_update_remote_config(
    agent: State<'_, MinimalAgent>,
    host: String,
    port: Option<u16>,
    auth_token: Option<String>,
    auto_connect: Option<bool>,
) -> CommandResult<RemoteConfigSnapshot> {
    let next = RemoteConfig {
        host: host.trim().to_string(),
        port: port.unwrap_or(4732),
        auth_token: auth_token
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty()),
        auto_connect: auto_connect.unwrap_or(false),
    };
    Ok(RemoteConfigSnapshot::from(&agent.set_remote_config(next)))
}

/// 当前桌面侧 transport 状态(默认 disconnected)。`driver` 任务在后续
/// 阶段会写入真实 up/down 状态;本命令返回的总是 disconnected,因为本轮
/// 没有真实 transport 任务。
#[tauri::command]
pub async fn reflect_get_remote_status() -> CommandResult<RemoteStatus> {
    Ok(RemoteStatus::disconnected(
        "remote transport driver not yet implemented (Phase 2 follow-up)",
    ))
}

/// 探测本地 Tailscale daemon。返回 app-core 的 `TailscaleStatus`(已序列化
/// 友好的 camelCase 形式)。
#[tauri::command]
pub async fn reflect_tailscale_status() -> CommandResult<ReflectTailscaleStatus> {
    Ok(tailscale::detect().await)
}

/// 给 iOS 配置页用的 hint 字符串(显示用户需要在桌面终端运行什么命令
/// 来暴露 daemon 端口)。
#[tauri::command]
pub async fn reflect_tailscale_daemon_command_preview() -> CommandResult<String> {
    Ok(tailscale::daemon_command_preview().await)
}

/// 占位:实际启动桌面 daemon(shell out `tailscaled` + bind 0.0.0.0:4732)。
/// 本轮返回未实现错误——前端 UI 渲染提示但不执行实际命令。
#[tauri::command]
pub async fn reflect_tailscale_daemon_start() -> CommandResult<String> {
    Ok("not implemented yet (Phase 2 follow-up)".into())
}

/// 占位:停止 daemon。
#[tauri::command]
pub async fn reflect_tailscale_daemon_stop() -> CommandResult<String> {
    Ok("not implemented yet (Phase 2 follow-up)".into())
}

/// 占位:查询 daemon 进程状态。
#[tauri::command]
pub async fn reflect_tailscale_daemon_status() -> CommandResult<String> {
    Ok("not implemented yet (Phase 2 follow-up)".into())
}

// ── SSH 远程开发(会话层接缝;docs/plans/ssh-remote.md)────────────────
//
// 远端跑 `zhuye serve`(stdio JSONL),桌面以 SSH 子进程为传输成为协议
// 客户端。host 注册表持久化 `$ZHUYE_HOME/remote-hosts.json`;连接走
// `state/remote.rs` 的 RemoteSessionManager(事件泵进既有 session/background
// 通道,submit 经前台插槽分流)。远端前置:已装 zhuye CLI(BatchMode
// 密钥认证;连接时以 `zhuye --version` 探测,失败给安装引导)。

/// 远程主机列表(注册表读口)。
#[tauri::command]
pub async fn reflect_remote_hosts() -> CommandResult<Vec<crate::state::remote::RemoteHost>> {
    Ok(crate::state::remote::load_hosts())
}

/// 新增/覆盖一台远程主机(按 name 幂等)。返回更新后的列表。
#[tauri::command]
pub async fn reflect_remote_host_save(
    name: String,
    host: String,
    port: Option<u16>,
    user: Option<String>,
) -> CommandResult<Vec<crate::state::remote::RemoteHost>> {
    let name = name.trim().to_string();
    let host = host.trim().to_string();
    if name.is_empty() || host.is_empty() {
        return Err(CommandError {
            msg: "name 与 host 不能为空".into(),
        });
    }
    let mut hosts = crate::state::remote::load_hosts();
    let entry = crate::state::remote::RemoteHost {
        name,
        host,
        port: port.unwrap_or(22),
        user: user.map(|u| u.trim().to_string()).filter(|u| !u.is_empty()),
    };
    match hosts.iter_mut().find(|h| h.name == entry.name) {
        Some(slot) => *slot = entry,
        None => hosts.push(entry),
    }
    crate::state::remote::save_hosts(&hosts).map_err(CommandError::from)?;
    Ok(hosts)
}

/// 删除一台远程主机。返回更新后的列表。
#[tauri::command]
pub async fn reflect_remote_host_remove(
    name: String,
) -> CommandResult<Vec<crate::state::remote::RemoteHost>> {
    let mut hosts = crate::state::remote::load_hosts();
    hosts.retain(|h| h.name != name);
    crate::state::remote::save_hosts(&hosts).map_err(CommandError::from)?;
    Ok(hosts)
}

/// 连通性 + 远端 CLI 探测:`ssh <host> -- zhuye --version`(BatchMode)。
/// 返回版本行;失败给引导文案(装 CLI / 配密钥)。
#[tauri::command]
pub async fn reflect_remote_test(
    host: String,
    port: Option<u16>,
    user: Option<String>,
) -> CommandResult<String> {
    let entry = crate::state::remote::RemoteHost {
        name: "probe".into(),
        host: host.trim().to_string(),
        port: port.unwrap_or(22),
        user: user
            .filter(|u| !u.trim().is_empty())
            .map(|u| u.trim().to_string()),
    };
    if entry.host.is_empty() {
        return Err(CommandError {
            msg: "host 不能为空".into(),
        });
    }
    // 复用传输 argv 组装(替换远端命令为 --version)。
    let mut argv = crate::state::remote::ssh_argv_for_probe(&entry);
    let bin = argv.remove(0);
    let out = tokio::process::Command::new(&bin)
        .args(&argv)
        .output()
        .await
        .map_err(|e| CommandError {
            msg: crate::state::remote::spawn_error_message(&bin, e),
        })?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(CommandError {
            msg: format!(
                "远端不可达或 zhuye 未安装(退出码 {:?}):{};确认已配密钥(BatchMode)且远端已装 zhuye CLI",
                out.status.code(),
                stderr.trim()
            ),
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// 连接远程会话:拉起 serve 并等握手。返回会话 id(uuid 字符串,前端
/// 据此 bind / 提交)。
#[tauri::command]
pub async fn reflect_remote_connect(
    agent: State<'_, MinimalAgent>,
    host: String,
    cwd: String,
) -> CommandResult<String> {
    let entry = crate::state::remote::load_hosts()
        .into_iter()
        .find(|h| h.name == host)
        .ok_or_else(|| CommandError {
            msg: format!("远程主机不存在: {host}"),
        })?;
    let cwd = cwd.trim().to_string();
    if cwd.is_empty() {
        return Err(CommandError {
            msg: "远端工作目录不能为空".into(),
        });
    }
    crate::state::remote::connect(&agent, &entry, &cwd)
        .await
        .map_err(CommandError::from)
}

/// bind 到远程会话(前台插槽置位;后续 submit/interrupt 路由远端)。
#[tauri::command]
pub async fn reflect_remote_bind(agent: State<'_, MinimalAgent>, sid: String) -> CommandResult<()> {
    if !crate::state::remote::is_remote_session(&agent, &sid).await {
        return Err(CommandError {
            msg: format!("远程会话不存在或已断开: {sid}"),
        });
    }
    crate::state::remote::set_foreground_remote(&agent, Some(sid));
    Ok(())
}

/// 断开远程会话(杀 serve 子进程;远端 rollout 已落盘可 resume)。
#[tauri::command]
pub async fn reflect_remote_disconnect(
    agent: State<'_, MinimalAgent>,
    sid: String,
) -> CommandResult<()> {
    crate::state::remote::disconnect(&agent, &sid)
        .await
        .map_err(CommandError::from)
}

/// 活跃远程会话列表(sid / host / cwd)。
#[tauri::command]
pub async fn reflect_remote_sessions(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<Vec<RemoteSessionInfo>> {
    let foreground = crate::state::remote::foreground_remote(&agent);
    let sessions = crate::state::remote::active_sessions(&agent).await;
    Ok(sessions
        .into_iter()
        .map(|(sid, host, cwd)| RemoteSessionInfo {
            is_foreground: foreground.as_deref() == Some(sid.as_str()),
            sid,
            host,
            cwd,
        })
        .collect())
}

/// 活跃远程会话信息(camelCase 出线)。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSessionInfo {
    pub sid: String,
    pub host: String,
    pub cwd: String,
    /// 是否为当前前台远程会话。
    pub is_foreground: bool,
}

// ── v1.11 基建#12:远程网页访问状态 ─────────────────────────────────────

/// v1.11 基建#12:启动远程网页状态服务器(`GET /status` 只读诊断 JSON)。
/// 已在跑时幂等替换。`auth_token` 非空时端点强制校验。
/// 返回实际绑定端口。
#[tauri::command]
pub async fn reflect_status_server_start(
    agent: State<'_, MinimalAgent>,
    port: Option<u16>,
) -> CommandResult<u16> {
    let token = agent.remote_config().auth_token;
    crate::status_server::start((*agent).clone(), port.unwrap_or(4732), token)
        .await
        .map_err(|e| CommandError {
            msg: format!("bind status server failed: {e}"),
        })
}

/// 停止状态服务器(未运行时 no-op)。
#[tauri::command]
pub async fn reflect_status_server_stop() -> CommandResult<()> {
    crate::status_server::stop().await;
    Ok(())
}

/// 当前服务器状态(运行端口;未启动 → `None`)。
#[tauri::command]
pub async fn reflect_status_server_state() -> CommandResult<Option<u16>> {
    Ok(crate::status_server::running_port())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_carries_endpoint_and_ready_flag() {
        let cfg = RemoteConfig {
            host: "node.tail.net".into(),
            port: 4732,
            auth_token: Some("secret".into()),
            auto_connect: true,
        };
        let snap = RemoteConfigSnapshot::from(&cfg);
        assert_eq!(snap.endpoint, "node.tail.net:4732");
        assert!(snap.is_ready);
        assert!(snap.auto_connect);
    }

    #[test]
    fn snapshot_marks_unready_when_token_empty() {
        let cfg = RemoteConfig {
            host: "h".into(),
            auth_token: Some(String::new()),
            ..Default::default()
        };
        let snap = RemoteConfigSnapshot::from(&cfg);
        assert!(!snap.is_ready);
    }

    #[test]
    fn snapshot_preserves_explicit_port_in_host() {
        let cfg = RemoteConfig {
            host: "10.0.0.1:9001".into(),
            port: 4732,
            ..Default::default()
        };
        assert_eq!(cfg.endpoint(), "10.0.0.1:9001");
    }
}
