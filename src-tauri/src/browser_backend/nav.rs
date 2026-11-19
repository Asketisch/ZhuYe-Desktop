//! 面板导航命令的后端实现(地址栏 / 后退 / 前进 / 刷新 / 设备模拟)。
//!
//! 与 screencast 的常驻连接分开:每条命令开一条**短连接**
//! (connect → getTargets → attachToTarget → send → 回复 → drop),
//! 用完即断,互不抢通道。浏览器未运行时 `browser_ws_endpoint()`
//! 返回结构化错误,前端如实展示。
//!
//! 目标模型与 [`super::first_page_target`] 一致:浏览器级 ws 上
//! `Target.getTargets` 取第一个 page target,`Target.attachToTarget
//! (flatten=true)` 拿 sessionId 后发 page 级命令。
//!
//! 导航等待走 raw ws 而非 `CdpConnection`:后者的往返按 id 匹配读回
//! 响应、**吞掉途经事件**,而导航要顺带读 `Page.loadEventFired` /
//! `Page.frameNavigated`。

use std::time::Duration;

use serde_json::{Value, json};
use tokio_tungstenite::tungstenite::Message;

use super::BrowserStatusDto;

/// 导航整轮(回复 + 等待加载事件)的截止时间。
const NAVIGATE_TIMEOUT: Duration = Duration::from_secs(10);

// raw ws 半连接类型:与 screencast 同款管线(connect_async + split)。
type RawWs =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
type RawWsTx = futures_util::stream::SplitSink<RawWs, Message>;
type RawWsRx = futures_util::stream::SplitStream<RawWs>;

/// 地址栏输入规范化:无 scheme 时补 `https://`。
///
/// 规则:
/// - 已带合法 scheme(字母开头 + `[alnum+.-]*`,且冒号后不是
///   host:port 形态)原样返回 —— 覆盖 `http(s)://` / `file://` /
///   `about:` 等;
/// - `localhost:3000` / `127.0.0.1:8080` 这类 host:port 不误判为
///   scheme(冒号后到第一个 `/ ? #` 为止是纯数字),照常补 `https://`;
/// - 其余(域名、域名+路径)统一补 `https://`;不做搜索引擎兜底。
fn normalize_url(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if let Some((scheme, rest)) = trimmed.split_once(':') {
        let valid_scheme = !scheme.is_empty()
            && scheme
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphabetic())
            && scheme
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
        // `host:port` 判定:冒号后首个路径段是纯数字(可带路径/查询)。
        let port_like = rest
            .split(['/', '?', '#'])
            .next()
            .is_some_and(|head| !head.is_empty() && head.chars().all(|c| c.is_ascii_digit()));
        if valid_scheme && !port_like {
            return trimmed.to_string();
        }
    }
    format!("https://{trimmed}")
}

/// 地址栏导航:规范化输入 → `Page.navigate` → best-effort 等加载完成
/// (≤10s)。返回导航后状态;浏览器未运行时报结构化错误。
pub async fn navigate(
    agent: &crate::state::MinimalAgent,
    raw_url: &str,
) -> Result<BrowserStatusDto, String> {
    let url = normalize_url(raw_url);
    if url.is_empty() {
        return Err("地址为空,无法导航".to_string());
    }
    let captured = page_navigate(&url).await?;
    // 事件窗口没等到 frameNavigated 时以请求地址兜底
    // (重定向的最终 URL 由 screencast 跟踪随后修正)。
    let url_out = captured.unwrap_or_else(|| url.clone());
    let mut manager = agent.inner.browser.lock().await;
    manager.last_url = Some(url_out.clone());
    // 旧页标题失效(frameNavigated 不带 title,暂无标题跟踪源)。
    manager.last_title = None;
    Ok(BrowserStatusDto {
        running: true,
        url: Some(url_out),
        title: None,
        streaming: manager.streaming(),
        message: None,
    })
}

/// 后退一步(导航历史越界时 no-op)。
pub async fn back(agent: &crate::state::MinimalAgent) -> Result<BrowserStatusDto, String> {
    history_go(-1).await?;
    super::status(agent).await
}

/// 前进一步(导航历史越界时 no-op)。
pub async fn forward(agent: &crate::state::MinimalAgent) -> Result<BrowserStatusDto, String> {
    history_go(1).await?;
    super::status(agent).await
}

/// 刷新当前页(`ignoreCache: false`)。
pub async fn reload(agent: &crate::state::MinimalAgent) -> Result<BrowserStatusDto, String> {
    page_command("Page.reload", json!({ "ignoreCache": false })).await?;
    super::status(agent).await
}

/// 应用设备模拟尺寸(0/0 = 清除 override 复位;预设清单在前端)。
pub async fn set_device(
    agent: &crate::state::MinimalAgent,
    width: u32,
    height: u32,
) -> Result<BrowserStatusDto, String> {
    if width == 0 || height == 0 {
        page_command("Emulation.clearDeviceMetricsOverride", json!({})).await?;
    } else {
        page_command(
            "Emulation.setDeviceMetricsOverride",
            json!({ "width": width, "height": height, "deviceScaleFactor": 1, "mobile": false }),
        )
        .await?;
    }
    super::status(agent).await
}

/// 打开短连接并 attach 第一个 page target(flatten)。
/// 返回 (连接, sessionId) —— 命令用完即 drop。
async fn attach_page() -> Result<(reflect_browser::cdp::CdpConnection, String), String> {
    let ws_url = super::browser_ws_endpoint()?;
    let mut conn = reflect_browser::cdp::CdpConnection::connect(&ws_url)
        .await
        .map_err(|e| format!("CDP 连接失败: {e}"))?;
    let target = super::first_page_target_on(&mut conn).await?;
    let target_id = target
        .get("targetId")
        .and_then(Value::as_str)
        .ok_or_else(|| "page target 缺 targetId".to_string())?;
    let session = conn
        .command(
            "Target.attachToTarget",
            json!({ "targetId": target_id, "flatten": true }),
        )
        .await
        .map_err(|e| format!("Target.attachToTarget 失败: {e}"))?
        .get("sessionId")
        .and_then(Value::as_str)
        .ok_or_else(|| "attach 未返回 sessionId".to_string())?
        .to_string();
    Ok((conn, session))
}

/// 短连接执行一条 page 级命令(connect → attach → send → 回复 → drop)。
async fn page_command(method: &str, params: Value) -> Result<Value, String> {
    let (mut conn, session) = attach_page().await?;
    conn.command_on_target(&session, method, params)
        .await
        .map_err(|e| format!("{method} 失败: {e}"))
}

/// 历史导航(后退/前进共用):`Page.getNavigationHistory` → 越界 no-op
/// → `Page.navigateToHistoryEntry`。
async fn history_go(delta: i64) -> Result<(), String> {
    let (mut conn, session) = attach_page().await?;
    let history = conn
        .command_on_target(&session, "Page.getNavigationHistory", json!({}))
        .await
        .map_err(|e| format!("Page.getNavigationHistory 失败: {e}"))?;
    let index = history
        .get("currentIndex")
        .and_then(Value::as_i64)
        .ok_or_else(|| "导航历史缺 currentIndex".to_string())?;
    let entries = history
        .get("entries")
        .and_then(Value::as_array)
        .ok_or_else(|| "导航历史缺 entries".to_string())?;
    let target = index + delta;
    if target < 0 || target >= entries.len() as i64 {
        // 已在边界:无操作,不算错误。
        return Ok(());
    }
    let entry_id = entries[target as usize]
        .get("id")
        .and_then(Value::as_i64)
        .ok_or_else(|| "导航历史条目缺 id".to_string())?;
    conn.command_on_target(
        &session,
        "Page.navigateToHistoryEntry",
        json!({ "entryId": entry_id }),
    )
    .await
    .map_err(|e| format!("Page.navigateToHistoryEntry 失败: {e}"))?;
    Ok(())
}

/// raw ws 上的一次命令往返:发请求 → 读到匹配 id 的回复为止
/// (途经事件丢弃)。整轮共用调用方传入的截止时间;`session` 为
/// flatten 目标会话(page 级命令必传,浏览器级命令传 None)。
async fn cdp_roundtrip_raw(
    sink: &mut RawWsTx,
    stream: &mut RawWsRx,
    id: u64,
    session: Option<&str>,
    method: &str,
    params: Value,
    deadline: tokio::time::Instant,
) -> Result<Value, String> {
    use futures_util::{SinkExt, StreamExt};

    let mut req = json!({ "id": id, "method": method, "params": params });
    if let Some(session) = session {
        req["sessionId"] = json!(session);
    }
    sink.send(Message::Text(req.to_string().into()))
        .await
        .map_err(|e| format!("CDP 发送失败: {e}"))?;
    loop {
        let msg = tokio::time::timeout_at(deadline, stream.next())
            .await
            .map_err(|_| format!("{method} 回复超时"))?;
        let text = match msg {
            Some(Ok(Message::Text(text))) => text,
            Some(Ok(_)) => continue,
            Some(Err(err)) => return Err(format!("CDP 连接错误({method}): {err}")),
            None => return Err(format!("CDP 连接已关闭({method})")),
        };
        let Ok(v) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        if v.get("id").and_then(Value::as_u64) == Some(id) {
            if let Some(err) = v.get("error") {
                return Err(format!("{method} 失败: {err}"));
            }
            return Ok(v.get("result").cloned().unwrap_or(Value::Null));
        }
    }
}

/// `Page.navigate` + best-effort 等待加载完成(≤10s)。
///
/// 走 raw ws 管线(见模块注释)。返回捕获的最终 URL(主 frame 的
/// `Page.frameNavigated`;超时/未等到时为 None,不算错误)。
async fn page_navigate(url: &str) -> Result<Option<String>, String> {
    use futures_util::StreamExt;

    let ws_url = super::browser_ws_endpoint()?;
    let (ws, _resp) = tokio_tungstenite::connect_async(&ws_url)
        .await
        .map_err(|e| format!("CDP 连接失败: {e}"))?;
    let (mut sink, mut stream) = ws.split();
    // 整轮共享一个截止:命令回复阶段一般瞬时,事件窗口吃剩余时间。
    let deadline = tokio::time::Instant::now() + NAVIGATE_TIMEOUT;

    // 定位 page target 并 attach(flatten)。
    let targets = cdp_roundtrip_raw(
        &mut sink,
        &mut stream,
        1,
        None,
        "Target.getTargets",
        json!({}),
        deadline,
    )
    .await?;
    let target = targets
        .get("targetInfos")
        .and_then(Value::as_array)
        .and_then(|list| {
            list.iter()
                .find(|t| t.get("type").and_then(Value::as_str) == Some("page"))
                .cloned()
        })
        .ok_or_else(|| "浏览器无 page target".to_string())?;
    let target_id = target
        .get("targetId")
        .and_then(Value::as_str)
        .ok_or_else(|| "page target 缺 targetId".to_string())?;
    let session = cdp_roundtrip_raw(
        &mut sink,
        &mut stream,
        2,
        None,
        "Target.attachToTarget",
        json!({ "targetId": target_id, "flatten": true }),
        deadline,
    )
    .await?
    .get("sessionId")
    .and_then(Value::as_str)
    .ok_or_else(|| "attach 未返回 sessionId".to_string())?
    .to_string();

    // 导航命令本身(回复通常瞬时返回;等待加载在下方事件窗口)。
    let reply = cdp_roundtrip_raw(
        &mut sink,
        &mut stream,
        3,
        Some(&session),
        "Page.navigate",
        json!({ "url": url }),
        deadline,
    )
    .await?;
    // CDP 把加载失败(如 DNS 解析失败)放在结果的 errorText 字段。
    if let Some(error_text) = reply.get("errorText").and_then(Value::as_str) {
        return Err(format!("导航失败: {error_text}"));
    }

    // 事件窗口:`loadEventFired` 即完成;`frameNavigated` 捕获主 frame
    // 最终 URL(重定向时以后者为准)。超时 = best-effort 到此为止。
    let mut final_url: Option<String> = None;
    loop {
        let text = match tokio::time::timeout_at(deadline, stream.next()).await {
            Ok(Some(Ok(Message::Text(text)))) => text,
            _ => break,
        };
        let Ok(v) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        match v.get("method").and_then(Value::as_str) {
            Some("Page.frameNavigated") => {
                let frame = v.pointer("/params/frame");
                // 主 frame 判定:无 parentId(iframe 导航不算)。
                let is_main = frame.and_then(|f| f.get("parentId")).is_none();
                if is_main {
                    if let Some(u) = frame.and_then(|f| f.get("url")).and_then(Value::as_str) {
                        final_url = Some(u.to_string());
                    }
                }
            }
            Some("Page.loadEventFired") => break,
            _ => {}
        }
    }
    Ok(final_url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_url_adds_https_to_bare_domains() {
        assert_eq!(normalize_url("example.com"), "https://example.com");
        assert_eq!(
            normalize_url("  example.com/path?q=1 "),
            "https://example.com/path?q=1"
        );
        assert_eq!(normalize_url("localhost"), "https://localhost");
    }

    #[test]
    fn normalize_url_keeps_existing_scheme() {
        assert_eq!(
            normalize_url("https://example.com/a?b=1"),
            "https://example.com/a?b=1"
        );
        assert_eq!(
            normalize_url("http://localhost:3000/app"),
            "http://localhost:3000/app"
        );
        assert_eq!(normalize_url("file:///tmp/a.html"), "file:///tmp/a.html");
        assert_eq!(normalize_url("about:blank"), "about:blank");
        assert_eq!(normalize_url("mailto:a@b.c"), "mailto:a@b.c");
    }

    #[test]
    fn normalize_url_does_not_treat_host_port_as_scheme() {
        assert_eq!(normalize_url("localhost:3000"), "https://localhost:3000");
        assert_eq!(
            normalize_url("localhost:3000/app"),
            "https://localhost:3000/app"
        );
        assert_eq!(normalize_url("127.0.0.1:8080"), "https://127.0.0.1:8080");
    }

    #[test]
    fn normalize_url_empty_input_stays_empty() {
        assert_eq!(normalize_url(""), "");
        assert_eq!(normalize_url("   "), "");
    }
}
