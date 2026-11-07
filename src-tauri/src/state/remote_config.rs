//! Remote mode config:连接 iOS / 远端 daemon 的目标与运行时状态。
//!
//! 仅进程内存储 —— 重启丢失配置;持久化(keyring 或 `~/.zhuye/remote.toml`)
//! 留作后续。

use serde::{Deserialize, Serialize};

/// 用户可编辑的远端 daemon 目标。字段名采用 snake_case(与 Rust 默认
/// 命名一致,IPC 层依赖同一形态)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RemoteConfig {
    /// 远端 daemon 的 `host:port`(iOS 或其他机器)。
    pub host: String,
    /// 可选 port 覆盖;默认 4732(对应 desktop daemon 在 `app-core::tailscale`
    /// 中的 `DEFAULT_DAEMON_PORT` 常量)。
    pub port: u16,
    /// 行分隔 JSON-RPC 链路的共享 bearer token。
    #[serde(default)]
    pub auth_token: Option<String>,
    /// 是否在启动时自动连接。当前仅为标记位,"启动时连接" 的实际 hook
    /// 留作后续接入。
    #[serde(default)]
    pub auto_connect: bool,
}

impl Default for RemoteConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: 4732,
            auth_token: None,
            auto_connect: false,
        }
    }
}

impl RemoteConfig {
    /// 渲染为 `host:port` 字符串(与 desktop daemon TCP 传输层期望的格式一致)。
    pub fn endpoint(&self) -> String {
        if self.host.contains(':') {
            self.host.clone()
        } else {
            format!("{}:{}", self.host, self.port)
        }
    }

    /// 当 host 和 auth_token 都已设置时返回 true(满足最低可连接条件)。
    pub fn is_ready(&self) -> bool {
        !self.host.is_empty() && self.auth_token.as_deref().is_some_and(|t| !t.is_empty())
    }
}

/// desktop 侧的运行时状态(传输 up/down、最近一次错误等)。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatus {
    /// `connected` | `disconnected` | `error`。
    pub state: String,
    /// 自由格式的诊断信息(最近一次错误 / 连接提示)。
    pub message: Option<String>,
    /// 当 `state == connected` 时,表示当前连接到的 host。
    pub endpoint: Option<String>,
    /// 进入当前状态的 Unix 毫秒时间戳。
    pub since_ms: Option<i64>,
}

impl RemoteStatus {
    pub fn disconnected(message: impl Into<String>) -> Self {
        Self {
            state: "disconnected".into(),
            message: Some(message.into()),
            endpoint: None,
            since_ms: Some(now_epoch_ms()),
        }
    }
}

fn now_epoch_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_endpoint_uses_default_port() {
        let cfg = RemoteConfig {
            host: "node.tail.net".into(),
            ..Default::default()
        };
        assert_eq!(cfg.endpoint(), "node.tail.net:4732");
    }

    #[test]
    fn endpoint_preserves_explicit_port() {
        let cfg = RemoteConfig {
            host: "node.tail.net:5555".into(),
            ..Default::default()
        };
        assert_eq!(cfg.endpoint(), "node.tail.net:5555");
    }

    #[test]
    fn is_ready_requires_both_host_and_token() {
        let mut cfg = RemoteConfig::default();
        assert!(!cfg.is_ready(), "empty config not ready");
        cfg.host = "host".into();
        assert!(!cfg.is_ready(), "missing token");
        cfg.auth_token = Some("t".into());
        assert!(cfg.is_ready(), "both host + token ready");
    }

    #[test]
    fn disconnected_status_carries_since_ms() {
        let s = RemoteStatus::disconnected("no peer");
        assert_eq!(s.state, "disconnected");
        assert_eq!(s.message.as_deref(), Some("no peer"));
        assert!(s.since_ms.is_some());
    }
}
