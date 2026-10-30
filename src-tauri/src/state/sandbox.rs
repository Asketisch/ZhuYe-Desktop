//! OS 沙箱策略在桌面端的落点。
//!
//! ## 背景
//!
//! 核心的 OS 沙箱有三条来源，桌面端此前一条都没接：
//!
//! - 配置 `[sandbox].os_level` —— 只写盘，不生效（死旋钮）；
//! - 协议 `ThreadSettingsOverrides.sandbox_policy` —— 从不设置，
//!   于是 `ToolContext.os_sandbox` 恒为 `None`；
//! - env `ZHUYE_SANDBOX_OS_LEVEL` —— 从不读。
//!
//! 结果是 `ToolContext.os_sandbox = None` → BashTool 走
//! `OsSandbox::from_env()` → env 未设置时**默认开启**，于是
//! 「配置写 false」与「实际跑在 Seatbelt 里」长期并存，状态栏显示的
//! 也是 env 推导值，与配置说的不是一回事。
//!
//! ## 现在
//!
//! - 每轮提交时按**后端配置快照**下发 `sandbox_policy`
//!   （`Op::UserInput.thread_settings`），核心把它映射成
//!   `ToolContext.os_sandbox` → 前台 bash 与后台 bash 两条路径同时生效；
//! - 状态查询用**同一份**有效开关 + 同一个 `OsSandbox::with_enabled`
//!   构造器计算，报出来的就是真正在跑的那个沙箱。
//!
//! 口径细节（env 优先 / 未表态走基线）见 `reflect_app_core::sandbox`。

use reflect_app_core::sandbox;

/// 进程 env `ZHUYE_SANDBOX_OS_LEVEL` 的原始值（若用户显式设过）。
///
/// 存在即表示**用户用 env 覆盖了配置** —— 状态面板要如实标注，
/// 否则用户在 Settings 里拨了开关却看不到变化，会以为设置失效。
pub(crate) fn env_override() -> Option<String> {
    std::env::var("ZHUYE_SANDBOX_OS_LEVEL").ok()
}

/// 当前进程**生效**的 OS 沙箱开关。
///
/// env 优先于配置（与核心 CLI 桥接注释一致：`ZHUYE_SANDBOX_OS_LEVEL=0`
/// 可临时覆盖配置）；env 未设置时用配置值（已由
/// `load_config_with_sandbox_baseline` 归一：未表态 = 基线开启）。
pub(crate) fn effective_os_sandbox_enabled(cfg_os_level: bool) -> bool {
    let env_raw = env_override();
    sandbox::resolve_os_sandbox_enabled(cfg_os_level, env_raw.as_deref())
}
