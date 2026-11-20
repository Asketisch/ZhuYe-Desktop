//! 页面会话:page 级 CDP 连接上同时跑**帧流**与**输入注入**。
//!
//! 与 [`super`] 的分工:后者管浏览器进程与状态快照,本模块只管「一条
//! page 级连接上的会话循环」——screencast 帧流、输入指令、视口量测
//! 三件事共用这条连接(另开连接会让拖拽手感崩掉)。
//!
//! ## 输入回执不自锁
//!
//! 输入命令的 CDP 回执要走同一条连接的 stream,而 stream 只在事件
//! 分支被读 —— 若在输入分支里 `await` 回执会自锁。故回执挂进
//! `pending` map,由事件分支按 id 匹配时回填。

use std::collections::HashMap;

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio_tungstenite::tungstenite::Message;
use tokio_util::sync::CancellationToken;

use super::input::{self, BrowserInputEvent};

type PageSocket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// CDP 帧编号为整数，确认后浏览器才会继续推送新画面。
fn frame_ack(frame: &Value) -> Option<Message> {
    let id = frame.pointer("/params/sessionId")?.as_u64()?;
    Some(Message::Text(
        json!({"id": 3, "method": "Page.screencastFrameAck", "params": {"sessionId": id}})
            .to_string()
            .into(),
    ))
}

/// 连接页面并等待浏览器确认启动帧流，失败时不向 UI 报告已启动。
pub(super) async fn connect_page_session(
    url: &str,
) -> Result<(PageSocket, Option<String>), String> {
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        let (mut ws, _) = tokio_tungstenite::connect_async(url).await
            .map_err(|err| format!("浏览器页面连接失败: {err}"))?;
        ws.send(Message::Text(json!({
            "id": 1, "method": "Page.startScreencast",
            "params": {"format": "jpeg", "quality": 70, "maxWidth": 1280, "maxHeight": 800, "everyNthFrame": 1}
        }).to_string().into())).await.map_err(|err| format!("启动浏览器画面失败: {err}"))?;
        let mut early_frame = None;
        while let Some(message) = ws.next().await {
            let message = message.map_err(|err| format!("浏览器画面连接中断: {err}"))?;
            let Message::Text(text) = message else { continue };
            let Ok(value) = serde_json::from_str::<Value>(&text) else { continue };
            if value.get("id").and_then(Value::as_u64) == Some(1) {
                if let Some(error) = value.get("error") {
                    return Err(format!("启动浏览器画面失败: {error}"));
                }
                return Ok((ws, early_frame));
            }
            if value.get("method").and_then(Value::as_str) == Some("Page.screencastFrame") {
                if let Some(ack) = frame_ack(&value) {
                    ws.send(ack).await.map_err(|err| format!("确认浏览器画面失败: {err}"))?;
                }
                if let Some(data) = value.pointer("/params/data").and_then(Value::as_str) {
                    early_frame = Some(data.to_string());
                }
            }
        }
        Err("浏览器画面连接已关闭".to_string())
    }).await.map_err(|_| "等待浏览器画面启动超时".to_string())?
}

/// 页面会话收到的一条指令。
///
/// 走页面级连接发出 —— [`PageCommand::Input`] 由会话任务换算坐标后
/// 转成 CDP Input 域命令；设备模拟也走此连接，确保覆盖在面板存活时保持生效。
pub enum PageCommand {
    /// 注入一次输入事件(回复走 oneshot 回传给调用方)。
    Input {
        event: BrowserInputEvent,
        reply: tokio::sync::oneshot::Sender<Result<(), String>>,
    },
    /// 修改设备尺寸并重测输入坐标所用的视口。
    SetDevice {
        width: u32,
        height: u32,
        reply: tokio::sync::oneshot::Sender<Result<(), String>>,
    },
}

/// 按 CDP 请求 id 跟踪调用方；设备切换须等视口重测完成再回执。
enum PendingReply {
    Input(tokio::sync::oneshot::Sender<Result<(), String>>),
    Device(tokio::sync::oneshot::Sender<Result<(), String>>),
    DeviceMetrics(tokio::sync::oneshot::Sender<Result<(), String>>),
}

/// 从 `Page.getLayoutMetrics` 的回复里取页面 **CSS 视口**尺寸。
///
/// 优先 `cssVisualViewport`(CSS 像素,与输入坐标同一量纲),退化到
/// `cssLayoutViewport` / `layoutViewport`。
fn css_viewport_of(reply: &Value) -> Option<(f64, f64)> {
    let result = reply.get("result")?;
    for key in [
        "cssVisualViewport",
        "cssLayoutViewport",
        "layoutViewport",
        "visualViewport",
    ] {
        let Some(vp) = result.get(key) else { continue };
        let w = vp.get("clientWidth").and_then(Value::as_f64)?;
        let h = vp.get("clientHeight").and_then(Value::as_f64)?;
        if w > 0.0 && h > 0.0 {
            return Some((w, h));
        }
    }
    None
}

/// 页面会话任务:page 级 ws 上同时跑**帧流**与**输入注入**。
///
/// - 帧流:`Page.startScreencast` → `Page.screencastFrame` 事件转
///   `zhuye_browser_frame` 推前端(必须回 ack,否则浏览器节流到 1 帧);
/// - 输入:收到 [`PageCommand::Input`] 时把归一化坐标换算成页面坐标后
///   发 `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`;
/// - 视口:`Page.getLayoutMetrics` 取 CSS 视口尺寸(输入坐标换算的基准),
///   导航 / 设备模拟后重新量。
///
/// 顺带跟踪 `Page.frameNavigated` 把主 frame 的最新 URL 记入共享的
/// [`super::BrowserManager`](导航/刷新期间 target 查询扑空时的状态兜底;
/// `Page.frameStartedLoading` 只带 frameId 没有 URL,无法用于跟踪)。
pub(super) async fn run_page_session(
    ws: PageSocket,
    emit_frame: impl Fn(String) + Send + 'static,
    cancel: CancellationToken,
    agent: crate::state::MinimalAgent,
    mut input_rx: tokio::sync::mpsc::Receiver<PageCommand>,
) {
    /// 预留的命令 id:2=stopScreencast 3=frameAck
    /// 4=getLayoutMetrics 5=setFocusEmulationEnabled。
    const ID_STOP_SCREENCAST: u64 = 2;
    const ID_METRICS: u64 = 4;
    const ID_FOCUS: u64 = 5;

    let (mut sink, mut stream) = ws.split();
    // 订阅页面导航事件，更新地址栏并在导航后重量视口。
    let _ = sink
        .send(Message::Text(
            json!({"id": 6, "method": "Page.enable"}).to_string().into(),
        ))
        .await;
    // 无头页面默认不持有焦点 → 键盘事件无处可去。开启焦点模拟后页面
    // 恒为「聚焦」状态,输入注入的按键能被页面接收。
    let _ = sink
        .send(Message::Text(
            json!({"id": ID_FOCUS, "method": "Emulation.setFocusEmulationEnabled",
                   "params": {"enabled": true}})
            .to_string()
            .into(),
        ))
        .await;
    // 量一次 CSS 视口(输入坐标换算的基准)。
    let _ = sink
        .send(Message::Text(
            json!({"id": ID_METRICS, "method": "Page.getLayoutMetrics", "params": {}})
                .to_string()
                .into(),
        ))
        .await;

    // 待回执的输入命令(id → 回执通道)。
    let mut pending: HashMap<u64, PendingReply> = HashMap::new();
    // 自增命令 id(输入命令用)。
    let mut next_id: u64 = 100;
    // 页面 CSS 视口尺寸(输入换算用)。
    let mut viewport: Option<(f64, f64)> = None;

    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                // 优雅收尾:停 screencast 再断连。
                let _ = sink.send(Message::Text(
                    json!({"id": ID_STOP_SCREENCAST, "method": "Page.stopScreencast", "params": {}})
                        .to_string().into(),
                )).await;
                break;
            }
            // ===== 输入指令 =====
            Some(cmd) = input_rx.recv() => {
                match cmd {
                    PageCommand::SetDevice { width, height, reply } => {
                        let id = next_id;
                        next_id += 1;
                        let (method, params) = if width == 0 || height == 0 {
                            ("Emulation.clearDeviceMetricsOverride", json!({}))
                        } else {
                            ("Emulation.setDeviceMetricsOverride", json!({"width": width, "height": height, "deviceScaleFactor": 1, "mobile": false}))
                        };
                        if sink.send(Message::Text(json!({"id": id, "method": method, "params": params}).to_string().into())).await.is_ok() {
                            pending.insert(id, PendingReply::Device(reply));
                        } else {
                            let _ = reply.send(Err("浏览器连接已断开".to_string()));
                        }
                    }
                    PageCommand::Input { event, reply } => {
                        let Some(vp) = viewport else {
                            let _ = reply.send(Err("页面视口尺寸尚未就绪,请稍后重试".to_string()));
                            continue;
                        };
                        let (method, params) = input::to_cdp_command(&event, vp);
                        let id = next_id;
                        next_id += 1;
                        // 回执**不**在本分支里等 —— CDP 回复要走 stream,
                        // 而 stream 只在下方事件分支被读;在此 await 会自锁。
                        // 故把回执挂进 pending,由事件分支按 id 匹配时回填。
                        let mut reply = Some(reply);
                        let sent = sink
                            .send(Message::Text(
                                json!({"id": id, "method": method, "params": params})
                                    .to_string().into(),
                            ))
                            .await
                            .is_ok();
                        if sent {
                            pending.insert(id, PendingReply::Input(reply.take().expect("reply 尚未移交")));
                        } else if let Some(tx) = reply.take() {
                            let _ = tx.send(Err("浏览器连接已断开".to_string()));
                        }
                    }
                }
            }
            // ===== CDP 消息(事件 + 命令回复) =====
            msg = stream.next() => match msg {
                Some(Ok(Message::Text(text))) => {
                    let Ok(v) = serde_json::from_str::<Value>(&text) else { continue };
                    // 命令回复:先认 id(视口量测与输入命令的回执)。
                    if let Some(id) = v.get("id").and_then(Value::as_u64) {
                        if id == ID_METRICS {
                            if let Some(vp) = css_viewport_of(&v) {
                                viewport = Some(vp);
                            }
                            continue;
                        }
                        if let Some(pending_reply) = pending.remove(&id) {
                            match pending_reply {
                                PendingReply::Input(tx) => {
                                    let result = v.get("error").map_or(Ok(()), |err| Err(format!("CDP 错误: {err}")));
                                    let _ = tx.send(result);
                                }
                                PendingReply::Device(tx) => {
                                    if let Some(err) = v.get("error") {
                                        let _ = tx.send(Err(format!("CDP 错误: {err}")));
                                    } else {
                                        viewport = None;
                                        let metrics_id = next_id;
                                        next_id += 1;
                                        let metrics = json!({"id": metrics_id, "method": "Page.getLayoutMetrics", "params": {}});
                                        if sink.send(Message::Text(metrics.to_string().into())).await.is_ok() {
                                            pending.insert(metrics_id, PendingReply::DeviceMetrics(tx));
                                        } else {
                                            let _ = tx.send(Err("浏览器连接已断开".to_string()));
                                        }
                                    }
                                }
                                PendingReply::DeviceMetrics(tx) => {
                                    let result = if let Some(size) = css_viewport_of(&v) {
                                        viewport = Some(size);
                                        Ok(())
                                    } else {
                                        Err("页面视口尺寸读取失败".to_string())
                                    };
                                    let _ = tx.send(result);
                                }
                            }
                        }
                        continue;
                    }
                    let method = v.get("method").and_then(Value::as_str).unwrap_or_default();
                    if method == "Page.frameNavigated" {
                        // 主 frame 判定:无 parentId(iframe 导航不覆盖面板 URL)。
                        let frame = v.pointer("/params/frame");
                        let is_main = frame.and_then(|f| f.get("parentId")).is_none();
                        let url = frame
                            .and_then(|f| f.get("url"))
                            .and_then(Value::as_str)
                            .filter(|u| !u.is_empty());
                        if is_main {
                            if let Some(url) = url {
                                let mut manager = agent.inner.browser.lock().await;
                                manager.last_url = Some(url.to_string());
                            }
                        }
                        // 导航后视口可能变 → 重量一次。
                        let _ = sink.send(Message::Text(
                            json!({"id": ID_METRICS, "method": "Page.getLayoutMetrics", "params": {}})
                                .to_string().into(),
                        )).await;
                        continue;
                    }
                    if method != "Page.screencastFrame" {
                        continue;
                    }
                    // 必须回 ack,否则浏览器节流到 1 帧。
                    if let Some(ack) = frame_ack(&v) {
                        let _ = sink.send(ack).await;
                    }
                    if let Some(data) = v.pointer("/params/data").and_then(Value::as_str) {
                        emit_frame(data.to_string());
                    }
                }
                Some(Ok(_)) => continue,
                Some(Err(err)) => {
                    tracing::warn!(target: "zhuye_browser", %err, "screencast 连接错误");
                    break;
                }
                None => break,
            }
        }
    }
    cancel.cancel();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_ack_keeps_numeric_session_id() {
        let frame = json!({"params": {"sessionId": 42}});
        let Message::Text(text) = frame_ack(&frame).unwrap() else {
            panic!("确认消息应为文本")
        };
        let ack: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(ack["params"]["sessionId"], 42);
        assert!(frame_ack(&json!({"params": {"sessionId": "42"}})).is_none());
    }

    #[tokio::test]
    async fn start_reports_cdp_error() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            let mut ws = tokio_tungstenite::accept_async(socket).await.unwrap();
            let _ = ws.next().await;
            ws.send(Message::Text(
                json!({"id": 1, "error": {"message": "failed"}})
                    .to_string()
                    .into(),
            ))
            .await
            .unwrap();
        });
        let result = connect_page_session(&format!("ws://{addr}")).await;
        assert!(matches!(result, Err(error) if error.contains("failed")));
        server.await.unwrap();
    }

    /// 使用隔离临时 profile 验证真实帧流、导航及与桌面相同的输入通路。
    #[tokio::test]
    #[ignore = "需要本机安装 Chrome 或 Chromium"]
    async fn chrome_streams_frames_after_navigation() {
        let executable =
            zhuye_browser::chrome::discover_executable().expect("未找到 Chrome 或 Chromium");
        let profile = tempfile::tempdir().unwrap();
        let process = zhuye_browser::chrome::launch(&executable, profile.path(), true).unwrap();
        let (port, path) = process.devtools_port().unwrap();
        let browser_ws = zhuye_browser::chrome::browser_ws_url(port, &path);
        let target = super::super::first_page_target(&browser_ws).await.unwrap();
        let page_ws = super::super::page_endpoint(&browser_ws, &target).unwrap();
        let (socket, _) = connect_page_session(&page_ws).await.unwrap();
        let agent = crate::state::MinimalAgent::new_empty();
        let (tx, rx) = tokio::sync::mpsc::channel(16);
        agent.inner.browser.lock().await.input_tx = Some(tx.clone());
        let (frame_tx, mut frame_rx) = tokio::sync::mpsc::unbounded_channel();
        let cancel = CancellationToken::new();
        let task = tokio::spawn(run_page_session(
            socket,
            move |data| {
                let _ = frame_tx.send(data);
            },
            cancel.clone(),
            agent.clone(),
            rx,
        ));
        let mut page = zhuye_browser::cdp::CdpConnection::connect(&page_ws)
            .await
            .unwrap();
        page.command("Page.navigate", json!({"url": "data:text/html,<input id=field style='position:fixed;inset:0;width:100vw;height:100vh'>"})).await.unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(10), async {
            loop {
                let result = page.command("Runtime.evaluate", json!({"expression": "Boolean(document.querySelector('#field'))", "returnByValue": true})).await.unwrap();
                if result.pointer("/result/value").and_then(Value::as_bool) == Some(true) { break; }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
            let _ = frame_rx.recv().await.expect("缺少浏览器画面");
            let (reply, device_result) = tokio::sync::oneshot::channel();
            tx.send(PageCommand::SetDevice { width: 390, height: 844, reply }).await.unwrap();
            device_result.await.unwrap().unwrap();
            let size = page.command("Runtime.evaluate", json!({"expression":"[innerWidth,innerHeight]", "returnByValue":true})).await.unwrap();
            assert_eq!(size.pointer("/result/value"), Some(&json!([390, 844])));
            let down: BrowserInputEvent = serde_json::from_value(json!({"type":"mouseDown","x":0.5,"y":0.5,"button":"left","clickCount":1,"modifiers":0})).unwrap();
            input::dispatch(&agent, down).await.expect("设备切换后应立即可点击");
            let up = serde_json::from_value(json!({"type":"mouseUp","x":0.5,"y":0.5,"button":"left","clickCount":1,"modifiers":0})).unwrap();
            input::dispatch(&agent, up).await.unwrap();
            let key = serde_json::from_value(json!({"type":"key","action":"down","key":"a","code":"KeyA","text":"a","modifiers":0})).unwrap();
            input::dispatch(&agent, key).await.unwrap();
            let result = page.command("Runtime.evaluate", json!({"expression": "document.querySelector('#field').value", "returnByValue": true})).await.unwrap();
            assert_eq!(result.pointer("/result/value").and_then(Value::as_str), Some("a"));
            let _ = frame_rx.recv().await.expect("输入后缺少新画面");
        }).await.expect("浏览器交互超时");
        cancel.cancel();
        task.await.unwrap();
    }
}
