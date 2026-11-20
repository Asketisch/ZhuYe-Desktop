//! 受控浏览器面板后端:启动/attach 与 screencast 帧流。
//!
//! 与上游 `zhuye-browser` 插件共享同一发现契约:隔离 profile
//! (`$ZHUYE_HOME/browser-profile`)下的 `DevToolsActivePort` 文件 ——
//! 插件(agent 控制)与本模块(面板显示)谁先启动浏览器谁持有,
//! 后到方 attach 同一实例。
//!
//! ## 面板帧流
//!
//! Page 级 CDP 连接 + `Page.startScreencast`(JPEG，逐帧确认),
//! 帧经 `zhuye_browser_frame` 事件推前端(`<img src=data:...>` 渲染;
//! CSP `img-src data:` 已允许)。
//!
//! ## 面板输入
//!
//! 同一条 page 级连接兼作**输入通道**:桌面面板的鼠标 / 滚轮 / 键盘
//! 经 `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` 注入页面,
//! 面板因此是真可交互的浏览器(此前只有只读画面)。坐标由前端送归一化
//! 值(0..1),后端按页面 CSS 视口换算 —— 见 [`input`] 模块。
//!
//! ## 面板导航
//!
//! 导航命令(后退/前进/刷新/地址栏)在 [`nav`] 子模块:每条命令开一条
//! **短连接**(connect → attach → send → 回复 → drop),不与 screencast
//! 连接互抢。screencast 循环顺带跟踪 `Page.frameNavigated` 把最新 URL
//! 记入 [`BrowserManager`],供状态查询在 CDP target 扑空时兜底。
//! 设备尺寸则必须走持续的页面会话：临时 CDP 会话断开时覆盖会失效。
//!
//! ## 子模块分工
//!
//! - `input` —— 输入事件模型与「事件 → CDP 命令」的换算(纯函数);
//! - `nav` —— 导航面命令(各自开短连接);
//! - `page` —— page 级连接上的会话循环(帧流 + 输入 + 视口量测)。
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;
use zhuye_browser::chrome;

mod input;
mod nav;
mod page;

pub use input::{BrowserInputEvent, dispatch as dispatch_input};
pub use nav::{back, forward, navigate, reload, set_device};
pub use page::PageCommand;

use page::{connect_page_session, run_page_session};

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
    /// 页面会话的输入通道 —— 帧流与输入共用一条 page 级连接。
    input_tx: Option<tokio::sync::mpsc::Sender<PageCommand>>,
    /// 最近帧供面板重新挂载时重放；每次重连使用新的缓存。
    last_frame: Arc<Mutex<Option<String>>>,
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
/// targetId)。
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

/// 从浏览器目标信息构造页面级连接地址。
fn page_endpoint(browser_ws: &str, target: &Value) -> Result<String, String> {
    let target_id = target
        .get("targetId")
        .and_then(Value::as_str)
        .ok_or_else(|| "page target 缺 targetId".to_string())?;
    let (origin, _) = browser_ws
        .split_once("/devtools/browser/")
        .ok_or_else(|| "浏览器连接地址格式异常".to_string())?;
    Ok(format!("{origin}/devtools/page/{target_id}"))
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
        let status = status_locked(&manager).await?;
        let frame = manager
            .last_frame
            .lock()
            .ok()
            .and_then(|value| value.clone());
        if let Some(data) = frame {
            let _ = tauri::Emitter::emit(&app, "zhuye_browser_frame", BrowserFramePayload { data });
        }
        return Ok(status);
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

    // 2) 建立 page 级连接并等待帧流确认。
    let page_ws_url = page_endpoint(&browser_ws_endpoint()?, &target)?;

    let (page_socket, early_frame) = connect_page_session(&page_ws_url).await?;
    let cancel = CancellationToken::new();
    // 帧流与输入共用一条 page 级连接:页面会话任务同时处理 screencast
    // 事件流与输入指令(见 page::run_page_session)。
    let (input_tx, input_rx) = tokio::sync::mpsc::channel::<PageCommand>(64);
    // screencast 任务顺带跟踪导航事件:经共享 inner 写回 last_url
    // (锁短暂持有;start 返回后即释放,不会与锁互等)。
    // MinimalAgent Clone 廉价(内部全 Arc),整只传入即可。
    let last_frame = Arc::new(Mutex::new(early_frame.clone()));
    let stream_frame = last_frame.clone();
    let stream_app = app.clone();
    tokio::spawn(run_page_session(
        page_socket,
        move |data| {
            if let Ok(mut latest) = stream_frame.lock() {
                *latest = Some(data.clone());
            }
            let _ = tauri::Emitter::emit(
                &stream_app,
                "zhuye_browser_frame",
                BrowserFramePayload { data },
            );
        },
        cancel.clone(),
        agent.clone(),
        input_rx,
    ));
    // 重连自己持有的浏览器时保留进程句柄，避免覆盖时 Drop 终止进程。
    if process.is_some() {
        manager.process = process;
    }
    manager.screencast_cancel = Some(cancel);
    manager.input_tx = Some(input_tx);
    manager.last_frame = last_frame;
    manager.last_url = target.get("url").and_then(Value::as_str).map(String::from);
    manager.last_title = target
        .get("title")
        .and_then(Value::as_str)
        .map(String::from);

    if let Some(data) = early_frame {
        let _ = tauri::Emitter::emit(&app, "zhuye_browser_frame", BrowserFramePayload { data });
    }

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
    // 页面会话随之结束 → 输入通道一并失效(否则会等到对端关闭才报错)。
    manager.input_tx = None;
    manager.last_frame = Arc::default();
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

/// profile 目录暴露给诊断(与上游发现契约一致)。
pub fn profile_dir() -> PathBuf {
    chrome::profile_dir()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_endpoint_uses_target_id_from_cdp_target_info() {
        let target = json!({"targetId": "ABC", "type": "page"});
        assert_eq!(
            page_endpoint("ws://127.0.0.1:9222/devtools/browser/xyz", &target).unwrap(),
            "ws://127.0.0.1:9222/devtools/page/ABC"
        );
        assert!(page_endpoint("ws://127.0.0.1:9222/devtools/browser/xyz", &json!({})).is_err());
    }

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
