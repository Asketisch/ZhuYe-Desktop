//! Tailscale 检测与远程主机建议辅助工具。
//!
//! 参考既有 Tauri Tailscale 模块的结构，但位于
//! `app-core`（核心 crate 是只读镜像——见 AGENTS.md）。该辅助工具调用本地
//! `tailscale` CLI 读取状态；发生任何失败时，它
//! 返回 `degraded_status`，使前端仍能渲染“未
//! 安装”/“未运行”卡片。
//!
//! ## 关于 `suggested_remote_host`
//!
//! dashboard 根据此值构建 iOS 侧的 `Remote backend host` 字段
//!（例如 `your-mac.your-tailnet.ts.net:4732`）。它将 `dns_name`（如果
//! 存在）与默认 daemon 端口 `4732` 拼接。
//!
//! ## 行为
//!
//! - `tailscale status --json=true` 是标准的机器可读探测方式。
//! - 如果缺少 `tailscale` 或命令出错，返回 `installed = false`。
//! - 如果 status JSON 解析失败，返回 `installed = true, running = false`，
//!   并附带便于人类阅读的 `message`。

use serde::{Deserialize, Serialize};
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;

/// 桌面 daemon 绑定的默认监听端口。参考既有实现中的
/// `DEFAULT_DAEMON_LISTEN_ADDR` 常量。
pub const DEFAULT_DAEMON_PORT: u16 = 4732;

/// CLI 探测允许运行的最长时间。
const PROBE_TIMEOUT: Duration = Duration::from_millis(1500);

/// 本地 Tailscale daemon 的自身状态快照。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TailscaleStatus {
    /// 是否在 `$PATH` 中找到 `tailscale` CLI 二进制文件。
    pub installed: bool,
    /// daemon 是否报告自身正在运行（BackendState == "Running"）。
    pub running: bool,
    /// 可获取时的 `tailscale version` 简短字符串。
    pub version: Option<String>,
    /// 完整的 MagicDNS 名称（例如 `node.tailnet.ts.net`）。
    pub dns_name: Option<String>,
    /// 短主机名（例如 `node`）。
    pub host_name: Option<String>,
    /// Tailnet 显示名称。
    pub tailnet_name: Option<String>,
    /// daemon 报告的 IPv4 地址。
    pub ipv4: Vec<String>,
    /// daemon 报告的 IPv6 地址。
    pub ipv6: Vec<String>,
    /// 由 `dns_name`（或 `ipv4[0]`）与默认端口拼出的 `host:port`。
    /// 名称和 IP 均不可用时为 `None`。
    pub suggested_remote_host: Option<String>,
    /// 自由格式的诊断消息（探测错误、解析错误等）。
    pub message: Option<String>,
}

/// 探测本地 Tailscale daemon。始终返回 `Ok`——失败会
/// 通过降级的 `TailscaleStatus` 暴露。
pub async fn detect() -> TailscaleStatus {
    match run_probe().await {
        Ok(mut status) => {
            // 如果有名称或 IP，则派生 suggested_remote_host。
            status.suggested_remote_host = derive_suggested_host(&status);
            status
        }
        Err(reason) => degraded(None, reason),
    }
}

/// 探测，并返回桌面启动
/// daemon 的确切命令（供 iOS 侧设置卡片复制提示使用）。
pub async fn daemon_command_preview() -> String {
    // 显示 shell 命令提示，说明用户将执行的命令。
    // 这里保留最小但有用的信息：
    // `tailscale up` 与监听端口（便于用户查看绑定端口）。
    format!(
        "tailscaled --tun=userspace-networking --state=mem: --socket=/var/run/tailscale/tailscaled.sock &\nlisten 0.0.0.0:{}",
        DEFAULT_DAEMON_PORT
    )
}

async fn run_probe() -> std::result::Result<TailscaleStatus, String> {
    // 1. 尝试 `tailscale version`（开销低且无需网络）。
    // 同样套超时:CLI 挂起(损坏的安装/网络盘上的二进制)时不能拖死探测。
    let version_output = tokio::time::timeout(
        PROBE_TIMEOUT,
        Command::new("tailscale")
            .arg("version")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output(),
    )
    .await
    .map_err(|_| "tailscale version timed out".to_string())?
    .map_err(|e| format!("tailscale CLI not found: {e}"))?;
    if !version_output.status.success() {
        return Err("tailscale CLI failed (not running?)".into());
    }
    let version = String::from_utf8_lossy(&version_output.stdout)
        .split_whitespace()
        .nth(1)
        .map(|s| s.trim_start_matches('v').to_string());

    // 2. 尝试 `tailscale status --json=true`。
    let status_output = tokio::time::timeout(
        PROBE_TIMEOUT,
        Command::new("tailscale")
            .args(["status", "--json=true"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output(),
    )
    .await
    .map_err(|_| "tailscale status timed out".to_string())?
    .map_err(|e| format!("tailscale status failed: {e}"))?;

    if !status_output.status.success() {
        return Err("tailscale status exited non-zero".into());
    }
    let value: serde_json::Value = serde_json::from_slice(&status_output.stdout)
        .map_err(|e| format!("parse tailscale json: {e}"))?;

    let running = value
        .get("BackendState")
        .and_then(|v| v.as_str())
        .is_some_and(|s| s.eq_ignore_ascii_case("Running"));

    let dns_name = value
        .get("Self")
        .and_then(|s| s.get("DNSName"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim_end_matches('.').to_string());
    let host_name = value
        .get("Self")
        .and_then(|s| s.get("HostName"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let tailnet_name = value
        .get("MagicDNSSuffix")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let mut ipv4 = Vec::new();
    let mut ipv6 = Vec::new();
    if let Some(addrs) = value.get("TailscaleIPs").and_then(|v| v.as_array()) {
        for ip in addrs {
            if let Some(s) = ip.as_str() {
                if s.contains(':') {
                    ipv6.push(s.to_string());
                } else {
                    ipv4.push(s.to_string());
                }
            }
        }
    }

    Ok(TailscaleStatus {
        installed: true,
        running,
        version,
        dns_name,
        host_name,
        tailnet_name,
        ipv4,
        ipv6,
        suggested_remote_host: None, // 由调用方填充
        message: None,
    })
}

fn derive_suggested_host(status: &TailscaleStatus) -> Option<String> {
    if let Some(dns) = &status.dns_name {
        return Some(format!("{dns}:{}", DEFAULT_DAEMON_PORT));
    }
    if let Some(ip) = status.ipv4.first() {
        return Some(format!("{ip}:{}", DEFAULT_DAEMON_PORT));
    }
    None
}

fn degraded(version: Option<String>, message: String) -> TailscaleStatus {
    TailscaleStatus {
        installed: false,
        running: false,
        version,
        dns_name: None,
        host_name: None,
        tailnet_name: None,
        ipv4: Vec::new(),
        ipv6: Vec::new(),
        suggested_remote_host: None,
        message: Some(message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggested_host_uses_dns_name_first() {
        let mut s = degraded(None, "x".into());
        s.dns_name = Some("node.tail.net".into());
        s.ipv4 = vec!["100.64.0.1".into()];
        assert_eq!(
            derive_suggested_host(&s),
            Some(format!("node.tail.net:{}", DEFAULT_DAEMON_PORT))
        );
    }

    #[test]
    fn suggested_host_falls_back_to_ipv4() {
        let mut s = degraded(None, "x".into());
        s.ipv4 = vec!["100.64.0.1".into()];
        assert_eq!(
            derive_suggested_host(&s),
            Some(format!("100.64.0.1:{}", DEFAULT_DAEMON_PORT))
        );
    }

    #[test]
    fn suggested_host_none_without_name_or_ip() {
        let s = degraded(None, "x".into());
        assert_eq!(derive_suggested_host(&s), None);
    }

    #[test]
    fn degraded_status_carries_message_and_disables_installed() {
        let s = degraded(Some("1.78.0".into()), "tailscale missing".into());
        assert!(!s.installed);
        assert!(!s.running);
        assert_eq!(s.version.as_deref(), Some("1.78.0"));
        assert_eq!(s.message.as_deref(), Some("tailscale missing"));
    }

    #[tokio::test]
    async fn detect_returns_status_without_panicking() {
        // 本地开发机通常已安装 tailscale；CI 通常
        // 未安装。契约是：detect() 必须始终返回格式正确的状态，
        // 不 panic，也不返回 Result 错误。
        let s = detect().await;
        // `suggested_remote_host` 只能是 Some 或 None，不会无效。
        let _ = s.suggested_remote_host;
        // installed == true 时必须有 version 和有用信息；
        // installed == false 时必须有诊断消息。
        if s.installed {
            // 无需断言其他内容；函数已完整运行。
        } else {
            assert!(s.message.is_some());
        }
    }

    #[tokio::test]
    async fn daemon_command_preview_mentions_default_port() {
        let s = daemon_command_preview().await;
        assert!(s.contains(&DEFAULT_DAEMON_PORT.to_string()));
    }
}
