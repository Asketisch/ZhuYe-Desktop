//! macOS Dock badge 命令 —— 薄包装 `crate::dock` 的实现。
//!
//! 前端包装:`src/utils/commands/notifications.ts::reflect_set_dock_badge`。
//! 命令体按领域归入 `commands/`(见 AGENTS.md 命令表约定),使
//! `src/app.smoke.test.tsx` 的 IPC parity 扫描能覆盖。

use tauri::State;

use crate::state::MinimalAgent;

/// 设置 macOS Dock badge(`None` 清空;非 macOS 为 no-op)。
///
/// 应用句柄从托管状态取(而非直接当参数)—— 命令签名不与 runtime 绑死,
/// 能力覆盖层才能用 mock runtime 驱动真实命令体。句柄缺失(未 setup)
/// 时静默 no-op。
#[tauri::command]
pub fn reflect_set_dock_badge(agent: State<'_, MinimalAgent>, label: Option<String>) {
    if let Some(app) = agent.app_handle() {
        crate::dock::set_dock_badge(&app, label);
    }
}
