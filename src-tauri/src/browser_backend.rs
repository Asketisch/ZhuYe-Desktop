//! 受控浏览器面板后端:启动/attach 与 screencast 帧流。
//!
//! 与上游 `zhuye-browser` 插件共享同一发现契约:隔离 profile
//! (`$ZHUYE_HOME/browser-profile`)下的 `DevToolsActivePort` 文件 ——
//! 插件(agent 控制)与本模块(面板显示)谁先启动浏览器谁持有,
//! 后到方 attach 同一实例。
//!
//! ## 面板帧流
//!
//! Page 级 CDP 连接 + `Page.startScreencast`(jpeg,everyNthFrame=2 节流),
//! 帧经 `zhuye_browser_frame` 事件推前端(`<img src=data:...>` 渲染;
//! CSP `img-src data:` 已允许)。screencast 连接**只读画面、不注入输入**
//! —— agent 控制与面板显示是两条独立连接,互不抢输入。
//!
//! ## 面板导航
//!
//! 导航命令(后退/前进/刷新/地址栏)在 [`nav`] 子模块:每条命令开一条
//! **短连接**(connect → attach → send → 回复 → drop),不与 screencast
//! 连接互抢。screencast 循环顺带跟踪 `Page.frameNavigated` 把最新 URL
//! 记入 [`BrowserManager`],供状态查询在 CDP target 扑空时兜底。

use std::path::PathBuf;

use serde::Serialize;
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;
use zhuye_browser::chrome;

mod nav;

pub use nav::{back, forward, navigate, reload, set_device};

/// 面板状态 DTO(camelCase 出线)。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserStatusDto {
    /// 浏览器是否在运行(有可连的 CDP 实例)。
    pub running: bool,
    /// 受控页面 URL(未知时为 null)。
    pub url: Option<String>,
    /// 页面标题(未知时为 null)。
    pub title: Option<String>,
    /// 面板帧流是否已启动。
    pub streaming: bool,
    /// 附加说明(如「attach 外部实例」),给前端展示。
    pub message: Option<String>,
}

/// `zhuye_browser_frame` 事件负载(base64 JPEG)。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserFramePayload {
    /// base64 编码的 JPEG 帧。
    pub data: String,
}

/// 浏览器管理器:持有的进程与 screencast 取消令牌。
///
/// 存放于 [`crate::state::MinimalAgentInner`](`browser` 字段);
/// `BrowserProcess` Drop 时回收我们拉起的 headless 实例。
#[derive(Default)]
pub struct BrowserManager {
    /// 本模块拉起的浏览器进程(attach 的外部实例为 None,不回收)。
    process: Option<chrome::BrowserProcess>,
    /// screencast 帧流任务取消令牌(运行中为 Some)。
    screencast_cancel: Option<CancellationToken>,
    /// 最近已知页面 URL(screencast 跟踪 `Page.frameNavigated` 写入;
    /// 状态查询的 CDP target 扑空时兜底显示)。
    last_url: Option<String>,
    /// 最近已知页面标题(来源同上;`frameNavigated` 不带 title,常为 None)。
    last_title: Option<String>,
}

impl BrowserManager {
    pub fn new() -> Self {
        Self::default()
    }

    fn streaming(&self) -> bool {
        self.screencast_cancel
            .as_ref()
            .is_some_and(|t| !t.is_cancelled())
    }
}

/// 解析当前实例的浏览器级 ws 端点(profile 的 DevToolsActivePort)。
fn browser_ws_endpoint() -> Result<String, String> {
    let profile = chrome::profile_dir();
    let file = profile.join("DevToolsActivePort");
    let content = std::fs::read_to_string(&file)
        .map_err(|_| format!("DevToolsActivePort 不存在({}),浏览器未启动", file.display()))?;
    let (port, path) = chrome::parse_devtools_active_port(&content)
        .ok_or_else(|| "DevToolsActivePort 格式异常".to_string())?;
    Ok(chrome::browser_ws_url(port, &path))
}

/// 浏览器级连接上取第一个 page target(targetInfo 带 url / title /
/// webSocketDebuggerUrl / targetId)。
async fn first_page_target_on(
    conn: &mut zhuye_browser::cdp::CdpConnection,
) -> Result<Value, String> {
    let result = conn
        .command("Target.getTargets", json!({}))
        .await
        .map_err(|e| format!("Target.getTargets 失败: {e}"))?;
    result
        .get("targetInfos")
        .and_then(Value::as_array)
        .and_then(|targets| {
            targets
                .iter()
                .find(|t| t.get("type").and_then(Value::as_str) == Some("page"))
                .cloned()
        })
        .ok_or_else(|| "浏览器无 page target".to_string())
}

/// 打开短连接解析第一个 page target(每次调用独立连接,用完即断)。
async fn first_page_target(ws_url: &str) -> Result<Value, String> {
    let mut conn = zhuye_browser::cdp::CdpConnection::connect(ws_url)
        .await
        .map_err(|e| format!("CDP 连接失败: {e}"))?;
    first_page_target_on(&mut conn).await
}

/// 启动浏览器(必要时)并开始 screencast 帧流。
///
/// 返回启动后的状态;已连接外部实例时只 attach(不回收);重复调用
/// 幂等(已在流则直接返回当前状态)。
pub async fn start(agent: &crate::state::MinimalAgent) -> Result<BrowserStatusDto, String> {
    // 句柄检查放最前:能力覆盖层(mock runtime)无句柄,这里就返回结构化
    // 错误 —— 绝不能在测试环境探测到本机 Chrome 后真的拉起浏览器。
    let app = agent
        .app_handle()
        .ok_or_else(|| "应用句柄未就绪,无法启动浏览器面板(真实运行时由 setup 注入)".to_string())?;
    let _ = app;
    let mut manager = agent.inner.browser.lock().await;

    // 已在流 → 直接回报状态(幂等)。
    if manager.streaming() {
        return status_locked(&manager).await;
    }

    // 1) 已有实例 → attach;失败(陈旧端口文件)→ 清掉后启动新实例。
    let mut process: Option<chrome::BrowserProcess> = None;
    let mut message: Option<String> = None;
    let target = match browser_ws_endpoint() {
        Ok(url) => match first_page_target(&url).await {
            Ok(target) => {
                message = Some("attach 运行中的浏览器实例".to_string());
                target
            }
            Err(err) => {
                tracing::warn!(target: "zhuye_browser", %err, "已有实例不可达,启动新实例");
                let _ = std::fs::remove_file(chrome::profile_dir().join("DevToolsActivePort"));
                let (target, proc) = launch_new_instance().await?;
                process = Some(proc);
                target
            }
        },
        Err(_) => {
            let (target, proc) = launch_new_instance().await?;
            process = Some(proc);
            target
        }
    };

    // 2) page 级 ws 直连 screencast(只读画面)。
    let page_ws_url = target
        .get("webSocketDebuggerUrl")
        .and_then(Value::as_str)
        .ok_or_else(|| "page target 缺 webSocketDebuggerUrl".to_string())?
        .to_string();

    let cancel = CancellationToken::new();
    // screencast 任务顺带跟踪导航事件:经共享 inner 写回 last_url
    // (锁短暂持有;start 返回后即释放,不会与锁互等)。
    // MinimalAgent Clone 廉价(内部全 Arc),整只传入即可。
    tokio::spawn(run_screencast(
        page_ws_url,
        app,
        cancel.clone(),
        agent.clone(),
    ));
    manager.process = process;
    manager.screencast_cancel = Some(cancel);
    manager.last_url = target.get("url").and_then(Value::as_str).map(String::from);
    manager.last_title = target
        .get("title")
        .and_then(Value::as_str)
        .map(String::from);

    Ok(BrowserStatusDto {
        running: true,
        url: target.get("url").and_then(Value::as_str).map(String::from),
        title: target
            .get("title")
            .and_then(Value::as_str)
            .map(String::from),
        streaming: true,
        message,
    })
}

/// 启动新 headless 实例并返回 (page target, 进程句柄)。
async fn launch_new_instance() -> Result<(Value, chrome::BrowserProcess), String> {
    let executable = chrome::discover_executable().ok_or_else(|| {
        "本机未找到 Chrome/Chromium/Edge;可设 ZHUYE_BROWSER_EXECUTABLE 指向可执行文件".to_string()
    })?;
    let profile = chrome::profile_dir();
    let process = chrome::launch(&executable, &profile, true).map_err(|e| e.to_string())?;
    let (port, path) = process.devtools_port().map_err(|e| e.to_string())?;
    let ws_url = chrome::browser_ws_url(port, &path);
    let target = first_page_target(&ws_url).await?;
    Ok((target, process))
}

/// 停止面板帧流与(本模块拉起的)浏览器实例。
pub async fn stop(agent: &crate::state::MinimalAgent) -> Result<BrowserStatusDto, String> {
    let mut manager = agent.inner.browser.lock().await;
    if let Some(token) = manager.screencast_cancel.take() {
        token.cancel();
    }
    // 面板已离场:记忆值一并清掉,避免状态查询回退到陈旧 URL。
    manager.last_url = None;
    manager.last_title = None;
    // 本模块拉起的实例直接回收(Drop 内 kill + wait);外部实例(插件或
    // 用户手动启动)只停画面流,不动浏览器本体。
    let message = if manager.process.take().is_some() {
        Some("已停止浏览器实例".to_string())
    } else {
        Some("该浏览器实例非本应用启动,已停止画面流但保留浏览器".to_string())
    };
    Ok(BrowserStatusDto {
        // stop 之后是否仍有实例:外部实例仍存活(DevToolsActivePort 判据)。
        running: chrome::profile_dir().join("DevToolsActivePort").exists(),
        url: None,
        title: None,
        streaming: false,
        message,
    })
}

/// 查询当前状态(**不启动浏览器**:status 无副作用)。
pub async fn status(agent: &crate::state::MinimalAgent) -> Result<BrowserStatusDto, String> {
    let manager = agent.inner.browser.lock().await;
    status_locked(&manager).await
}

async fn status_locked(manager: &BrowserManager) -> Result<BrowserStatusDto, String> {
    match browser_ws_endpoint() {
        Ok(url) => match first_page_target(&url).await {
            Ok(target) => Ok(BrowserStatusDto {
                running: true,
                url: target.get("url").and_then(Value::as_str).map(String::from),
                title: target
                    .get("title")
                    .and_then(Value::as_str)
                    .map(String::from),
                streaming: manager.streaming(),
                message: None,
            }),
            // target 查询扑空(导航瞬间 target 短暂不可见等):画面流仍在
            // → 仍算运行;URL/标题退回 screencast 跟踪的记忆值。
            Err(err) => Ok(BrowserStatusDto {
                running: manager.streaming(),
                url: manager.last_url.clone(),
                title: manager.last_title.clone(),
                streaming: manager.streaming(),
                message: Some(err),
            }),
        },
        Err(msg) => Ok(BrowserStatusDto {
            running: false,
            url: None,
            title: None,
            streaming: false,
            message: Some(msg),
        }),
    }
}

/// screencast 帧流任务:page 级 ws + Page.startScreencast → 事件转发。
///
/// 只读事件流,不注入任何输入;连接断开静默结束(面板可重新 start)。
/// 顺带跟踪 `Page.frameNavigated` 把主 frame 的最新 URL 记入共享的
/// [`BrowserManager`](导航/刷新期间 target 查询扑空时的状态兜底;
/// `Page.frameStartedLoading` 只带 frameId 没有 URL,无法用于跟踪)。
async fn run_screencast(
    page_ws_url: String,
    app: tauri::AppHandle,
    cancel: CancellationToken,
    agent: crate::state::MinimalAgent,
) {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;

    let connect = tokio_tungstenite::connect_async(&page_ws_url).await;
    let Ok((ws, _resp)) = connect else {
        tracing::warn!(target: "zhuye_browser", "screencast 连接失败:{connect:?}");
        return;
    };
    let (mut sink, mut stream) = ws.split();
    let start = json!({
        "id": 1,
        "method": "Page.startScreencast",
        "params": {
            "format": "jpeg",
            "quality": 70,
            "maxWidth": 1280,
            "maxHeight": 800,
            "everyNthFrame": 2,
        }
    });
    if sink
        .send(Message::Text(start.to_string().into()))
        .await
        .is_err()
    {
        return;
    }
    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                // 优雅收尾:停 screencast 再断连。
                let _ = sink.send(Message::Text(
                    json!({"id": 2, "method": "Page.stopScreencast", "params": {}})
                        .to_string().into(),
                )).await;
                break;
            }
            msg = stream.next() => match msg {
                Some(Ok(Message::Text(text))) => {
                    let Ok(v) = serde_json::from_str::<Value>(&text) else { continue };
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
                        continue;
                    }
                    if method != "Page.screencastFrame" {
                        continue;
                    }
                    // 必须回 ack,否则浏览器节流到 1 帧。
                    let frame_session = v
                        .pointer("/params/sessionId")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    let _ = sink.send(Message::Text(json!({
                        "id": 3,
                        "method": "Page.screencastFrameAck",
                        "params": {"sessionId": frame_session},
                    }).to_string().into())).await;
                    if let Some(data) = v.pointer("/params/data").and_then(Value::as_str) {
                        let payload = BrowserFramePayload { data: data.to_string() };
                        let _ = tauri::Emitter::emit(&app, "zhuye_browser_frame", &payload);
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
}

/// profile 目录暴露给诊断(与上游发现契约一致)。
pub fn profile_dir() -> PathBuf {
    chrome::profile_dir()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_dto_is_camel_case() {
        let dto = BrowserStatusDto {
            running: true,
            url: Some("https://example.com".into()),
            title: None,
            streaming: true,
            message: None,
        };
        let json = serde_json::to_value(&dto).unwrap();
        assert!(json.get("running").is_some());
        assert!(json.get("streaming").is_some());
        assert!(json.get("title").is_some());
    }

    #[test]
    fn frame_payload_serializes_data_field() {
        let payload = BrowserFramePayload { data: "abc".into() };
        let json = serde_json::to_value(&payload).unwrap();
        assert_eq!(json["data"], "abc");
    }
}
