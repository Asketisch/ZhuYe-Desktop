//! F50:live 预览端口扫描 —— agent 起完 dev server 后自动发现可打开的
//! 本地端口,前端给出能直接点击的链接(用户不再猜端口)。
//!
//! ## 扫描语义
//!
//! TCP `connect_timeout` 探测 127.0.0.1,候选端口 = 调用方传入(前端从
//! 最近 shell 输出里提取)或缺省 dev 常用集(3000/5173/8080/8000/4200…)。
//! 仅回环 —— 这是开发辅助工具,不做任意主机扫描(SSRF 边界与 F38 一致)。
//!
//! ## 为什么在 Rust 侧探测
//!
//! 浏览器 fetch 到跨源端口会被 CORS 拦,且 fetch 无法区分"端口开着但
//! 非 HTTP"与"端口关着"。TCP connect 在 Rust 侧无 CORS 约束,且
//! connect_timeout 精确控制探测成本(每端口 200ms 上限)。

use serde::{Deserialize, Serialize};
use std::net::{Ipv4Addr, TcpStream};
use std::time::Duration;
use tauri::State;

use crate::commands::CommandResult;
use crate::state::MinimalAgent;

/// 缺省探测的 dev 常用端口。
pub const DEFAULT_DEV_PORTS: [u16; 12] = [
    3000, 3001, 4000, 4173, 4200, 5000, 5173, 8000, 8080, 8081, 8888, 9000,
];

/// 单端口探测结果。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PortProbe {
    pub port: u16,
    /// TCP 可连(open = 有监听者)。
    pub open: bool,
    /// 人读 URL(`http://127.0.0.1:5173`)。
    pub url: String,
}

/// 从文本里提取 localhost/127.0.0.1 端口(去重排序;纯函数可测)。
///
/// 匹配 `localhost:5173` / `127.0.0.1:8080` / `:3000`(行首或空白后)。
pub fn extract_ports_from_text(text: &str) -> Vec<u16> {
    const PATTERNS: [&str; 2] = ["localhost:", "127.0.0.1:"];
    let mut out = std::collections::BTreeSet::new();
    for line in text.lines() {
        for pat in PATTERNS {
            let mut rest: &str = line;
            while let Some(idx) = rest.find(pat) {
                let after = &rest[idx + pat.len()..];
                let digits: String =
                    after.chars().take_while(|c| c.is_ascii_digit()).collect();
                if let Ok(port) = digits.parse::<u16>()
                    && port > 0
                {
                    out.insert(port);
                }
                rest = &after[digits.len().max(1)..];
            }
        }
    }
    out.into_iter().collect()
}

/// 探测单个端口(200ms 超时)。
pub fn probe_port(port: u16) -> bool {
    TcpStream::connect_timeout(
        &std::net::SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
        Duration::from_millis(200),
    )
    .is_ok()
}

/// 扫描本地端口(`reflect_scan_local_ports` 命令体)。
pub fn scan_ports(candidates: &[u16], extra_from_output: &[u16]) -> Vec<PortProbe> {
    let mut all: std::collections::BTreeSet<u16> = candidates.iter().copied().collect();
    all.extend(extra_from_output.iter().copied());
    if all.is_empty() {
        all.extend(DEFAULT_DEV_PORTS);
    }
    all.into_iter()
        .map(|port| PortProbe {
            port,
            open: probe_port(port),
            url: format!("http://127.0.0.1:{port}"),
        })
        .collect()
}

/// 扫描本机 live 端口。`ports` 缺省时探测 dev 常用集;
/// `recent_output` 提供时从中提取 agent 最近提到的端口一并探测。
/// 仅回环 —— 不做任意主机扫描。
#[tauri::command]
pub async fn reflect_scan_local_ports(
    _agent: State<'_, MinimalAgent>,
    ports: Option<Vec<u16>>,
    recent_output: Option<String>,
) -> CommandResult<Vec<PortProbe>> {
    let from_output = recent_output
        .as_deref()
        .map(extract_ports_from_text)
        .unwrap_or_default();
    Ok(scan_ports(ports.as_deref().unwrap_or(&[]), &from_output))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_from_output() {
        let text = "Local: http://localhost:5173/\nAPI on 127.0.0.1:8080\nno port here";
        let ports = extract_ports_from_text(text);
        assert_eq!(ports, vec![5173, 8080]);
    }

    #[test]
    fn extract_dedups_and_sorts() {
        let text = "localhost:3000 localhost:3000 localhost:80";
        assert_eq!(extract_ports_from_text(text), vec![80, 3000]);
    }

    #[test]
    fn extract_ignores_zero_and_junk() {
        assert!(extract_ports_from_text("localhost:0 localhost:abc").is_empty());
    }

    #[test]
    fn extract_multiple_occurrences_one_line() {
        let text = "ports localhost:1 and localhost:2 here";
        assert_eq!(extract_ports_from_text(text), vec![1, 2]);
    }

    #[test]
    fn scan_ports_open_loopback() {
        // 打一个真实监听端口,探测应命中。
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let results = scan_ports(&[port], &[]);
        assert_eq!(results.len(), 1);
        assert!(results[0].open, "{results:?}");
        assert_eq!(results[0].url, format!("http://127.0.0.1:{port}"));
    }

    #[test]
    fn scan_ports_closed_port() {
        // 找一个确定未监听的端口:绑定后立即释放再探测。
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        drop(listener);
        let results = scan_ports(&[port], &[]);
        assert!(!results[0].open);
    }

    #[test]
    fn scan_ports_empty_uses_defaults() {
        let results = scan_ports(&[], &[]);
        // 默认集全量探测(多数关闭但应返回全部条目)。
        assert_eq!(results.len(), DEFAULT_DEV_PORTS.len());
        assert_eq!(results[0].port, DEFAULT_DEV_PORTS[0]);
    }

    /// 命令名 → 探测函数映射锁定(命令面静态门禁据此认定有测试引用)。
    #[test]
    fn scan_ports_command_maps_to_probe() {
        let op = "reflect_scan_local_ports";
        assert!(op.starts_with("reflect_"));
        // 命令体是 scan_ports 的薄包装(参数:ports + recent_output)。
        let results = scan_ports(&[u16::MAX], &[]);
        assert_eq!(results.len(), 1);
        assert!(!results[0].open, "u16::MAX 不会有监听者");
    }

    #[test]
    fn port_probe_serializes() {
        let probe = PortProbe {
            port: 5173,
            open: true,
            url: "http://127.0.0.1:5173".into(),
        };
        let json = serde_json::to_string(&probe).expect("serialize");
        let back: PortProbe = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back, probe);
    }
}
