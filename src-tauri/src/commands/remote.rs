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
