//! 沙箱运行时状态 —— 让「OS 沙箱到底有没有生效」在 GUI 里可见。
//!
//! ## 为什么需要
//!
//! 设置页有 `[sandbox].os_level` 开关,但用户看不到**实际**状态:本次
//! 运行到底用的是 macOS Seatbelt、Linux Landlock,还是压根没有后端
//! (降级 = 裸 `sh -c`)。安全相关的开关不可见 = 用户无法判断风险。
//!
//! ## 口径
//!
//! 本命令报的是**有效状态** —— 用与工具**完全相同**的构造器
//! (`OsSandbox::with_enabled(enabled)`)算,而不是另起一套推导:
//!
//! - `enabled` = 生效开关,来自「env `REFLECT_SANDBOX_OS_LEVEL` 优先,
//!   否则取配置 `[sandbox].os_level`(未表态 = 核心基线开启)」,
//!   见 `reflect_app_core::sandbox`;
//! - `OsSandbox::with_enabled(enabled)` 正是 BashTool 在
//!   `ctx.os_sandbox = Some(enabled)` 时走的构造器
//!   (`reflect-tools/src/builtins/bash.rs`),后台 bash 同理。
//!
//! 附带的 `osLevel` 是配置值,`backend` 是平台可用后端 —— 三者一起看
//! 才能判断「配置说开、平台支持、实际生效」。
//!
//! `envOverride` 非空 = 用户用进程 env 覆盖了配置(此时在 Settings 里
//! 拨开关看不到变化,属预期行为)。

use reflect_sandbox::{OsSandbox, OsSandboxStatus};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::error::CommandResult;
use crate::state::MinimalAgent;

/// 沙箱状态(camelCase 出线)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxStatus {
    /// 配置里的 `[sandbox].os_level` 值(未表态时已归一为基线开启)。
    pub os_level: bool,
    /// 有效状态:`disabled` / `seatbelt` / `landlock` / `no_backend`。
    pub status: String,
    /// 沙箱是否真的在生效(已启用且平台有后端)。
    pub active: bool,
    /// 平台可用的沙箱后端:`seatbelt` / `landlock` / `none`。
    pub backend: String,
    /// 核心给出的状态描述(一行,中文,用于 tooltip)。
    pub status_line: String,
    /// 生效开关(env 优先;未设置 env 时 = `os_level`)。
    pub enabled: bool,
    /// 进程 env `REFLECT_SANDBOX_OS_LEVEL` 的原始值(若用户显式设过)。
    pub env_override: Option<String>,
}

/// 查询当前生效的 OS 沙箱状态。
#[tauri::command]
pub async fn reflect_sandbox_status(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<SandboxStatus> {
    let os_level = agent.inner.cfg.read().sandbox.os_level;
    let env_override = crate::state::sandbox::env_override();
    let enabled = crate::state::sandbox::effective_os_sandbox_enabled(os_level);
    // 与 BashTool 同一构造器:ctx.os_sandbox = Some(enabled) 时走的就是它。
    let sandbox = OsSandbox::with_enabled(enabled);
    let status = sandbox.status();
    Ok(SandboxStatus {
        os_level,
        status: status_str(status).to_string(),
        active: sandbox.is_active(),
        backend: backend_str(reflect_sandbox::detect_backend()).to_string(),
        status_line: sandbox.status_line(),
        enabled,
        env_override,
    })
}

fn status_str(s: OsSandboxStatus) -> &'static str {
    match s {
        OsSandboxStatus::Disabled => "disabled",
        OsSandboxStatus::Seatbelt => "seatbelt",
        OsSandboxStatus::Landlock => "landlock",
        OsSandboxStatus::NoBackend => "no_backend",
    }
}

fn backend_str(s: OsSandboxStatus) -> &'static str {
    match s {
        OsSandboxStatus::Seatbelt => "seatbelt",
        OsSandboxStatus::Landlock => "landlock",
        _ => "none",
    }
}
