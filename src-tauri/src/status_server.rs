//! v1.11 基建#12:Tailscale 远程网页访问状态服务器。
//!
//! 一个**极小**的 HTTP 端点(手写 HTTP/1.1 GET 响应,零新依赖):
//! `GET /status` 返回 agent 诊断快照 JSON —— 配合 Tailscale 的
//! MagicDNS(`your-mac.your-tailnet.ts.net`),同一 tailnet 下的设备
//! (手机 / 平板)浏览器打开 `http://<dns>:<port>/status` 即可查看
//! 桌面 agent 的运行状态,无需在局域网内。
//!
//! 安全模型:
//! - 默认绑定 `0.0.0.0`(Tailscale 接口可达;未开 Tailscale 时仅
//!   本机/局域网可达 —— 状态页是**只读**诊断,无提交能力);
//! - `RemoteConfig.auth_token` 非空时强制校验(`?token=` 或
//!   `Authorization: Bearer`),不匹配 → 401;
//! - 非 `/status` 路径 → 404;非 GET → 405。
//!
//! 生命周期:全局单例(start 幂等替换;stop 经 `Notify` 优雅退出)。

use std::sync::Arc;

use once_cell::sync::Lazy;
use parking_lot::RwLock;
use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Notify;
use tokio::task::JoinHandle;

use crate::state::MinimalAgent;

/// 当前运行中的状态服务器(join handle + 停止信号)。`None` = 未启动。
static SERVER: Lazy<RwLock<Option<StatusServerHandle>>> = Lazy::new(|| RwLock::new(None));

struct StatusServerHandle {
    join: JoinHandle<()>,
    stop: Arc<Notify>,
    port: u16,
}

/// 状态服务器的对外提示(供 UI / 状态页展示访问 URL)。
pub(crate) fn status_server_hint() -> String {
    let port = running_port();
    match port {
        None => "status server not running".into(),
        Some(p) => format!(
            "http://<this-host>:{p}/status (reach via your tailnet, e.g. http://your-node.your-tailnet.ts.net:{p}/status)"
        ),
    }
}

/// 当前服务器状态(端口;未启动 → `None`)。
pub fn running_port() -> Option<u16> {
    SERVER.read().as_ref().map(|h| h.port)
}

/// 启动状态服务器(已在跑则先停旧实例 —— 幂等替换)。返回绑定端口。
pub async fn start(agent: MinimalAgent, port: u16, auth_token: Option<String>) -> std::io::Result<u16> {
    stop().await;
    let listener = TcpListener::bind(("0.0.0.0", port)).await?;
    let bound = listener.local_addr()?.port();
    let stop = Arc::new(Notify::new());
    let stop_for_task = stop.clone();
    let token = auth_token.filter(|t| !t.trim().is_empty());
    let token_protected = token.is_some();
    let token_for_task = token;
    let join = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = stop_for_task.notified() => break,
                accepted = listener.accept() => {
                    let Ok((stream, _)) = accepted else { break };
                    let agent = agent.clone();
                    let token = token_for_task.clone();
                    // 每连接独立任务;单请求体量极小,无需并发上限。
                    tokio::spawn(async move {
                        serve_one(stream, agent, token).await;
                    });
                }
            }
        }
    });
    *SERVER.write() = Some(StatusServerHandle { join, stop, port: bound });
    tracing::info!(port = bound, token_protected, "status server started");
    Ok(bound)
}

/// 停止状态服务器(未运行时 no-op)。
pub async fn stop() {
    let handle = SERVER.write().take();
    if let Some(h) = handle {
        h.stop.notify_waiters();
        // 等待 accept loop 退出(最多 2s,防挂死)。
        let _ = tokio::time::timeout(std::time::Duration::from_secs(2), h.join).await;
        tracing::info!(port = h.port, "status server stopped");
    }
}

/// 处理单个连接:解析请求行与 token,写响应。请求体被忽略(只读端点)。
async fn serve_one(
    mut stream: tokio::net::TcpStream,
    agent: MinimalAgent,
    auth_token: Option<String>,
) {
    // 读请求头(上限 8KB,防恶意超长)。
    let mut buf = vec![0u8; 8192];
    let n = match stream.read(&mut buf).await {
        Ok(n) if n > 0 => n,
        _ => return,
    };
    let head = String::from_utf8_lossy(&buf[..n]);
    let mut lines = head.lines();
    let request_line = lines.next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();
    // Authorization: Bearer <token>(头名大小写不敏感 —— reqwest 发小写
    // `authorization:`,浏览器/其他客户端可能发首字母大写)。
    let bearer = lines
        .find(|l| l.to_ascii_lowercase().starts_with("authorization: bearer "))
        .and_then(|l| l.split_once(':'))
        .map(|(_, v)| v.trim().strip_prefix("Bearer ").unwrap_or(v.trim()).to_string());

    // 非 GET → 405。
    if method != "GET" {
        write_response(&mut stream, 405, "Method Not Allowed", "text/plain", "use GET /status").await;
        return;
    }
    // 路径:/status(容忍 query string)。
    let path_only = path.split('?').next().unwrap_or_default();
    if path_only != "/status" {
        write_response(&mut stream, 404, "Not Found", "text/plain", "unknown path; try GET /status").await;
        return;
    }
    // token 校验:配置了 token 时,?token= 或 Bearer 必须命中其一。
    if let Some(expected) = &auth_token {
        let query_token = path
            .split_once('?')
            .map(|(_, q)| q)
            .and_then(|q| q.split('&').find(|kv| kv.starts_with("token=")))
            .map(|kv| kv.trim_start_matches("token=").to_string());
        let supplied = query_token.or(bearer);
        if supplied.as_deref() != Some(expected.as_str()) {
            write_response(&mut stream, 401, "Unauthorized", "text/plain", "missing or invalid token").await;
            return;
        }
    }
    // 诊断快照(agent_status 是同步、轻量读 —— 不阻塞 runtime)。
    let status = agent.agent_status();
    let tailscale_hint = status_server_hint();
    let body = json!({
        "service": "zhuye-desktop-status",
        "workspace": status.workspace,
        "model": status.model,
        "ready": status.ready,
        "has_model": status.has_model,
        "degraded_reason": status.degraded_reason,
        "tailscale_hint": tailscale_hint,
        "generated_at": chrono::Utc::now().to_rfc3339(),
    })
    .to_string();
    write_response(&mut stream, 200, "OK", "application/json", &body).await;
}

/// 写一个完整 HTTP/1.1 响应(Content-Length 精确,连接即关)。
async fn write_response(
    stream: &mut tokio::net::TcpStream,
    code: u16,
    reason: &str,
    content_type: &str,
    body: &str,
) {
    let head = format!(
        "HTTP/1.1 {code} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes()).await;
    let _ = stream.write_all(body.as_bytes()).await;
    let _ = stream.flush().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    /// start/stop 幂等:二次 start 替换旧实例,stop 后 running_port 为空。
    #[tokio::test]
    async fn start_stop_roundtrip() {
        let agent = MinimalAgent::new_empty();
        let port = start(agent.clone(), 0, None).await.expect("bind port 0");
        assert!(running_port().is_some());
        // HTTP GET /status 可达且返回 JSON。
        let url = format!("http://127.0.0.1:{port}/status");
        let resp = reqwest::get(&url).await.expect("GET /status");
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = resp.json().await.expect("json body");
        assert_eq!(body["service"], "zhuye-desktop-status");
        assert!(body["workspace"].is_string());
        stop().await;
        assert!(running_port().is_none());
        // stop 幂等。
        stop().await;
    }

    /// 配置 token 后:无 token → 401;正确 query token → 200;
    /// 错误 token → 401;Bearer → 200。
    #[tokio::test]
    async fn token_protects_endpoint() {
        let agent = MinimalAgent::new_empty();
        let port = start(agent, 0, Some("sekrit".into())).await.unwrap();
        let base = format!("http://127.0.0.1:{port}");
        let client = reqwest::Client::new();
        let r401 = client.get(format!("{base}/status")).send().await.unwrap();
        assert_eq!(r401.status(), 401);
        let r401b = client
            .get(format!("{base}/status?token=wrong"))
            .send()
            .await
            .unwrap();
        assert_eq!(r401b.status(), 401);
        let r200 = client
            .get(format!("{base}/status?token=sekrit"))
            .send()
            .await
            .unwrap();
        assert_eq!(r200.status(), 200);
        let r200b = client
            .get(format!("{base}/status"))
            .bearer_auth("sekrit")
            .send()
            .await
            .unwrap();
        assert_eq!(r200b.status(), 200);
        stop().await;
    }

    /// 非 /status 路径 404;POST 405。
    #[tokio::test]
    async fn path_and_method_guards() {
        let agent = MinimalAgent::new_empty();
        let port = start(agent, 0, None).await.unwrap();
        let client = reqwest::Client::new();
        let r404 = client
            .get(format!("http://127.0.0.1:{port}/other"))
            .send()
            .await
            .unwrap();
        assert_eq!(r404.status(), 404);
        let r405 = client
            .post(format!("http://127.0.0.1:{port}/status"))
            .send()
            .await
            .unwrap();
        assert_eq!(r405.status(), 405);
        stop().await;
    }
}
