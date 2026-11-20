//! `reflect-desktop` Tauri 2 后端库。
//!
//! ## 里程碑
//!
//! - **M1.x** (已): 协议桥 —— 19 个 Tauri command + Event 转发到前端,MinimalAgent stub。
//! - **M2.x** (当前): 真后端 —— MinimalAgent 改为嵌入 `reflect_core::AgentThread`
//!   (stub model + EchoTool,不依赖网络);4 个产品联动 (tray / menu / shortcut / dock) 实装;
//!   macOS close-to-tray。
//!
//! 蓝图:ZhuYe `docs/gui/03-architecture.md` §5 (M1.x 设计沉淀)。

mod agent_state;
pub mod browser_backend;
pub mod commands;
pub mod commands_registry;
pub mod dock;
pub mod events;
mod hook_store;
pub mod mcp;
mod media_backend;
mod memory_store;
pub mod menu;
mod persistence;
mod shell_sessions;
pub mod shortcut;
pub mod state;
pub mod status_server;
pub mod tray;
mod workspace_state;

use state::MinimalAgent;
use tauri::Manager;

pub use commands_registry::configure;

/// 启动 Tauri 应用:
///
/// 1. 注册 `MinimalAgent` (M2.x = 真 `reflect_core::AgentThread` + stub model);
/// 2. 注册全部 reflect command + ping + `reflect_set_dock_badge`;
/// 3. 注册 `tauri-plugin-global-shortcut` plugin;
/// 4. 在 setup 中:
///     - 启动 `forward_agent_events` 把 agent event 推到前端;
///     - 注册全局快捷键 + 应用菜单 + 托盘图标;
///     - 启动 `AgentThread` 的 会话事件转发器;
/// 5. `on_window_event` 拦截 macOS 关闭按钮 → hide (close-to-tray);
///    run 事件循环回调处理 `RunEvent::Reopen` (点击 Dock 图标) → 唤回主窗口。
///
/// 命令面来自 [`configure`] —— 与能力覆盖层测试共用同一份。
pub fn run() {
    tracing_subscriber::fmt::init();

    configure(tauri::Builder::<tauri::Wry>::new())
        // 应用自更新（OTA）：Rust 侧 UpdaterExt 驱动（commands/update.rs），
        // 更新端点与 minisign 公钥见 tauri.conf.json > plugins.updater。
        // 插件只在生产 runtime 注册：它初始化时**硬要求** config 里有
        // plugins.updater 段（缺段直接 PluginInitialization 失败），而能力
        // 覆盖层的 mock context 没有这段（Context.config 字段私有、外部无法
        // 补）。命令本体仍在共享 configure() 里，L3 走结构化错误路径覆盖。
        .plugin(tauri_plugin_updater::Builder::new().build())
        // ====== Menu (在 builder 阶段静态注入) ======
        .menu(menu::build_menu)
        .on_menu_event(menu::handle_menu_event)
        // ====== Setup ======
        .setup(|app: &mut tauri::App<tauri::Wry>| {
            // 0. 把应用句柄注入托管状态 —— 命令层做 OS 交互(原生对话框 /
            //    dock 徽标 / 终端事件推送)时从这里取句柄,命令签名因此不必
            //    收 `AppHandle`,也就不与 runtime 绑死。
            app.state::<MinimalAgent>()
                .set_app_handle(app.handle().clone());

            // 1. 系统托盘 (macOS-only,其他平台为 no-op)。Tray 必须在 setup 同步阶段建
            //    (因为 tray 注册在 sync builder context)。
            tray::build_tray(app.handle())?;

            // 2. 全局快捷键 (跨平台,plugin 注册)。
            //    注册失败(如 Cmd+Shift+Space 被截图/启动器类应用占用)只降级
            //    记日志,不阻断启动 —— 此前 `?` 上抛会让 run(...) panic,
            //    应用完全无法打开。
            if let Err(e) = shortcut::register_global_shortcuts(app.handle()) {
                tracing::warn!("[reflect-gui] global shortcut registration failed, continuing without it: {e}");
            }

            // 3. 启动时清空 dock badge。
            dock::set_dock_badge(app.handle(), None);

            // 4. 二段构造 AgentThread —— Tauri setup 闭包**不是** tokio runtime
            //    上下文,必须用 tauri::async_runtime::spawn 把 install 推迟到
            //    Tauri 内部 runtime 起来之后 (event loop 阶段)。
            //
            //    install_agent_thread() 内部会构造真 AgentThread (内部 tokio::spawn
            //    submission_loop) 并启动 session forwarder。
            let agent_for_install: MinimalAgent = (*app.state::<MinimalAgent>()).clone();
            tauri::async_runtime::spawn(async move {
                agent_for_install.install_agent_thread().await;
            });

            // 5. 启动 broadcast → Tauri event 转发 (独立于 install,可在 sync setup
            //    后立刻 spawn,broadcast channel 已 ready,subscriber 可以先于 agent
            //    安装;eventual lag 由 Tauri Emitter 端容忍)。
            let agent_for_forward: MinimalAgent = (*app.state::<MinimalAgent>()).clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let session_rx = agent_for_forward.subscribe_session();
                events::forward_agent_events(app_handle, session_rx).await;
            });
            // v1.x 后台持续运行:后台会话事件(带 session id)走独立通道
            // `reflect_session_event`,前端据此维护运行徽标 / 待确认提醒;
            // 前台通道 `reflect_event` 线格式与 reducer 语义不变。
            let agent_for_background: MinimalAgent = (*app.state::<MinimalAgent>()).clone();
            let app_handle_bg = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let background_rx = agent_for_background.subscribe_background();
                events::forward_background_events(app_handle_bg, background_rx).await;
            });

            tracing::info!(
                "[reflect-gui] setup complete (model={}, workspace={}); agent thread installing in async runtime",
                app.state::<MinimalAgent>().model_spec(),
                app.state::<MinimalAgent>().workspace().display()
            );

            Ok(())
        })
        // `Builder::run` 内部即 build + run 的组合,拆开后行为等价,
        // 换取 run 事件循环回调 —— 无回调的 `.run(ctx)` 会把
        // `RunEvent::Reopen` (点击 Dock 图标) 静默丢弃,close-to-tray
        // 隐藏后的主窗口将无法唤回。
        .build(tauri::generate_context!())
        .expect("error while building reflect-desktop")
        .run(|app, event| {
            // macOS:点击 Dock 图标(AppKit reopen)唤回主窗口。
            // `RunEvent::Reopen` 变体仅 macOS/iOS 编译,必须 cfg 守卫,
            // 否则 Linux/Windows CI 直接编译失败。
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } = event
            {
                reopen_main_window(app, has_visible_windows);
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = (app, event);
            }
        });
}

/// macOS Dock reopen 落点:无可见窗口时唤回主窗口。
///
/// close-to-tray 把关闭按钮降级为 `hide()`,被 `orderOut` 的窗口
/// 不会随 AppKit reopen 自动 `orderFront`,必须手动 `show()`;
/// 已有可见窗口时由 AppKit 默认激活行为接管。复用托盘的
/// [`tray::show_main_window`](show + unminimize + set_focus)。
///
/// 仅 macOS 存在:唯一调用点(`RunEvent::Reopen`)是 macOS/iOS 专属
/// 变体,Linux/Windows 下不编译本函数,否则 dead_code 撞
/// `[workspace.lints.rust] warnings = "deny"`(CI 实证)。
#[cfg(target_os = "macos")]
fn reopen_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>, has_visible_windows: bool) {
    if !has_visible_windows {
        tracing::debug!("[reflect-gui] dock reopen: showing main window");
        tray::show_main_window(app);
    }
}

// `ping` 命令体见 [`commands::health`] —— 单独成模块:`ping` 必须是 `pub`
// 才能被能力覆盖层测试经**真实** IPC 通路打(命令宏需 `#[macro_export]` 到
// crate 根;定义在 crate 根会与导出位置冲突)。

/// 仅 macOS 编译:模块内唯一测试锁的是 reopen 分发签名,被测函数是
/// macOS 专属 —— Linux/Windows 下连导入一起裁掉,否则 unused import
/// 撞 warnings = "deny"(CI ubuntu/windows 实证)。
#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use tauri::test::{mock_builder, mock_context, noop_assets};

    /// Dock reopen 分发不 panic:mock app 无 main 窗口时 `show_main_window`
    /// 为 no-op,两个分支都不应 panic。mock runtime 无法真实投递 Reopen、
    /// 也无法断言窗口可见性,这里锁住的是接线签名,防止重构静默丢分支。
    #[test]
    fn dock_reopen_dispatch_does_not_panic() {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock app");

        reopen_main_window(app.handle(), false);
        reopen_main_window(app.handle(), true);
    }
}
