//! 受控浏览器面板命令面(启动 / 停止 / 状态 / 导航 / 设备模拟)。
//!
//! agent 控制走上游 `zhuye-browser` 插件(MCP 工具,Prompt 审批);
//! 本命令面只管**桌面面板的显示通道**:screencast 帧流启停、状态查询
//! 与地址栏导航。两条通道共享同一发现契约(profile 目录的
//! `DevToolsActivePort`)。

use serde::{Deserialize, Serialize};

use crate::browser_backend::{self, BrowserStatusDto};
use crate::commands::error::CommandResult;
use crate::state::MinimalAgent;

/// 浏览器可执行文件覆盖 env(透传给上游 chrome.rs 的探测)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserEnvInfo {
    /// 覆盖 env 是否已设置。
    pub executable_override: bool,
    /// 隔离 profile 目录(诊断用)。
    pub profile_dir: String,
}

/// 注入一次输入事件(鼠标 / 滚轮 / 键盘)到受控页面。
///
/// 坐标为**归一化值**(0..1,相对面板里渲染出来的画面),后端按页面
/// CSS 视口换算 —— 详见 `browser_backend::input` 模块。
///
/// 浏览器未启动 / 页面会话已结束 → 结构化错误(面板如实展示)。
#[tauri::command]
pub async fn zhuye_browser_input(
    agent: tauri::State<'_, MinimalAgent>,
    event: browser_backend::BrowserInputEvent,
) -> CommandResult<()> {
    browser_backend::dispatch_input(&agent, event)
        .await
        .map_err(crate::commands::error::CommandError::from)
}

/// 启动浏览器(必要时)并开始面板帧流。重复调用幂等。
#[tauri::command]
pub async fn zhuye_browser_start(
    agent: tauri::State<'_, MinimalAgent>,
) -> CommandResult<BrowserStatusDto> {
    browser_backend::start(&agent)
        .await
        .map_err(crate::commands::error::CommandError::from)
}

/// 停止面板帧流;本模块拉起的实例一并回收,外部实例保留。
#[tauri::command]
pub async fn zhuye_browser_stop(
    agent: tauri::State<'_, MinimalAgent>,
) -> CommandResult<BrowserStatusDto> {
    browser_backend::stop(&agent)
        .await
        .map_err(crate::commands::error::CommandError::from)
}

/// 查询浏览器状态(**无副作用**:不启动、不连接页面级通道)。
#[tauri::command]
pub async fn zhuye_browser_status(
    agent: tauri::State<'_, MinimalAgent>,
) -> CommandResult<BrowserStatusDto> {
    browser_backend::status(&agent)
        .await
        .map_err(crate::commands::error::CommandError::from)
}

/// 诊断:profile 目录与可执行文件覆盖状态(设置页展示)。
#[tauri::command]
pub async fn zhuye_browser_env() -> CommandResult<BrowserEnvInfo> {
    Ok(BrowserEnvInfo {
        executable_override: std::env::var("ZHUYE_BROWSER_EXECUTABLE").is_ok(),
        profile_dir: browser_backend::profile_dir().display().to_string(),
    })
}

/// 地址栏导航:输入规范化(无 scheme 补 `https://`)→ `Page.navigate` →
/// best-effort 等加载完成(≤10s)。浏览器未运行时报结构化错误。
#[tauri::command]
pub async fn zhuye_browser_navigate(
    agent: tauri::State<'_, MinimalAgent>,
    url: String,
) -> CommandResult<BrowserStatusDto> {
    browser_backend::navigate(&agent, &url)
        .await
        .map_err(crate::commands::error::CommandError::from)
}

/// 后退一步(导航历史越界时 no-op)。
#[tauri::command]
pub async fn zhuye_browser_back(
    agent: tauri::State<'_, MinimalAgent>,
) -> CommandResult<BrowserStatusDto> {
    browser_backend::back(&agent)
        .await
        .map_err(crate::commands::error::CommandError::from)
}

/// 前进一步(导航历史越界时 no-op)。
#[tauri::command]
pub async fn zhuye_browser_forward(
    agent: tauri::State<'_, MinimalAgent>,
) -> CommandResult<BrowserStatusDto> {
    browser_backend::forward(&agent)
        .await
        .map_err(crate::commands::error::CommandError::from)
}

/// 刷新当前页(`ignoreCache: false`)。
#[tauri::command]
pub async fn zhuye_browser_reload(
    agent: tauri::State<'_, MinimalAgent>,
) -> CommandResult<BrowserStatusDto> {
    browser_backend::reload(&agent)
        .await
        .map_err(crate::commands::error::CommandError::from)
}

/// 应用设备模拟尺寸(0/0 = 清除 override 复位;预设清单在前端)。
#[tauri::command]
pub async fn zhuye_browser_set_device(
    agent: tauri::State<'_, MinimalAgent>,
    width: u32,
    height: u32,
) -> CommandResult<BrowserStatusDto> {
    browser_backend::set_device(&agent, width, height)
        .await
        .map_err(crate::commands::error::CommandError::from)
}
