//! OS 沙箱策略解析 —— 把「配置里的旋钮」翻译成「每轮真正生效的策略」。
//!
//! ## 口径（本模块是唯一事实源）
//!
//! ```text
//! env(REFLECT_SANDBOX_OS_LEVEL，若显式设置)  >  配置 [sandbox].os_level
//! ```
//!
//! - **env 优先** —— 与核心 CLI 的桥接注释一致（"env 优先于 TOML，让
//!   `REFLECT_SANDBOX_OS_LEVEL=0` 能临时覆盖配置"），也是运维临时降级
//!   的唯一逃生口。
//! - **配置未表态 → 基线开启** —— 核心的安全基线是
//!   `OsSandbox::default()` = `enabled + strict`（模块文档："v1.3 起
//!   `OsSandbox::default()` 返回 `enabled = true`，以满足『默认要求
//!   OS sandbox』的严格安全基线"）。核心 schema 的
//!   `SandboxSection::os_level` 是 `Option<bool>`（v1.7 起），`None` =
//!   用户没写 → 归一到基线开启；`Some(b)` = 显式表态 → 原样。
//!   [`load_config_with_sandbox_baseline`] / `reflect_save_config` 都把
//!   归一结果写回 cfg（恒为 `Some(有效值)`），Settings 的开关、状态栏
//!   徽标、每轮策略三者因此一致。
//!
//! ## 落地
//!
//! 桌面端每个 turn 通过协议的 `sandbox_policy` 下发（而不是改进程 env）：
//! - 开启 → `SandboxPolicy::OsSandbox` → `ToolContext.os_sandbox = Some(true)`
//! - 关闭 → `SandboxPolicy::WorkspaceOnly` → `ToolContext.os_sandbox = Some(false)`
//!
//! 核心的映射是 `matches!(p, SandboxPolicy::OsSandbox)`（见
//! `reflect-core/src/submission_loop.rs`），即 `OsSandbox` = 开 OS 层，
//! `WorkspaceOnly` / `FullAccess` = 关 OS 层（文件工具的路径检查不受影响）。
//! 走协议通道的好处：不用 `std::env::set_var`（Rust 2024 下是 `unsafe`，
//! 多线程进程里改 env 有 UB 风险），且天然按轮生效、覆盖前台 bash 与
//! 后台 bash 两条路径。

use reflect_protocol::SandboxPolicy;

/// 解析 env 值 `REFLECT_SANDBOX_OS_LEVEL` → 是否启用。
///
/// 与核心 `OsSandbox::from_env()` 的解析**逐条对齐**（含空串算关闭）：
/// `""` / `0` / `false` / `no` / `off` → 关闭；其它 → 开启。
pub fn parse_env_os_level(raw: &str) -> bool {
    !matches!(
        raw.trim().to_ascii_lowercase().as_str(),
        "" | "0" | "false" | "no" | "off"
    )
}

/// 把配置表态归一成**有效**的配置值（不含 env 覆盖）。
///
/// `None`（未表态）→ `true`（核心基线：默认要求 OS sandbox）；
/// `Some(b)`（显式表态）→ 原样。
pub fn normalize_os_level(os_level: Option<bool>) -> bool {
    os_level.unwrap_or(true)
}

/// 解析**最终生效**的 OS 沙箱开关。
///
/// - `env_raw` 为 `Some`（用户显式设了 env）→ env 优先。
/// - 否则用配置值（已由 [`normalize_os_level`] 归一）。
pub fn resolve_os_sandbox_enabled(cfg_os_level: bool, env_raw: Option<&str>) -> bool {
    match env_raw {
        Some(raw) => parse_env_os_level(raw),
        None => cfg_os_level,
    }
}

/// 有效开关 → 协议侧的每轮覆盖策略。
///
/// `OsSandbox` = 开 OS 层；`WorkspaceOnly` = 关 OS 层（核心的
/// `matches!(p, SandboxPolicy::OsSandbox)` 映射）。
pub fn sandbox_policy_for(enabled: bool) -> SandboxPolicy {
    if enabled {
        SandboxPolicy::OsSandbox
    } else {
        SandboxPolicy::WorkspaceOnly
    }
}

/// 读取 `~/.reflect/config.toml` 并把 `[sandbox].os_level` 归一成有效值。
///
/// 核心 schema 是 `Option<bool>`，解析后即可区分「没写」（`None`）与
/// 「写了 false」—— 不再需要嗅探原始 TOML。归一后，内存里的
/// `cfg.sandbox.os_level` 恒为 `Some(有效值)`（未表态 = 基线开启），
/// Settings 的开关与状态栏显示的策略因此一致。
///
/// 注：env 覆盖**不在这里**生效 —— env 是进程级逃生口，在真正决定
/// 每轮策略时（[`resolve_os_sandbox_enabled`]）才叠加，避免把「临时
/// 覆盖」烤进配置快照。
pub fn load_config_with_sandbox_baseline() -> reflect_config::ReflectConfig {
    let mut cfg = reflect_config::load_default();
    cfg.sandbox.os_level = Some(normalize_os_level(cfg.sandbox.os_level));
    cfg
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_parse_matches_core_semantics() {
        for off in ["0", "false", "FALSE", "no", "off", " off ", ""] {
            assert!(!parse_env_os_level(off), "应解析为关闭: {off:?}");
        }
        for on in ["1", "true", "yes", "on", "anything"] {
            assert!(parse_env_os_level(on), "应解析为开启: {on:?}");
        }
    }

    #[test]
    fn unset_os_level_follows_core_baseline() {
        // 未表态（None）→ 基线开启（核心 OsSandbox::default() = enabled + strict）。
        assert!(normalize_os_level(None));
    }

    #[test]
    fn explicit_os_level_is_respected() {
        assert!(!normalize_os_level(Some(false)));
        assert!(normalize_os_level(Some(true)));
    }

    #[test]
    fn env_overrides_config() {
        // env 优先于配置（与核心 CLI 桥接注释一致）。
        assert!(!resolve_os_sandbox_enabled(true, Some("0")));
        assert!(resolve_os_sandbox_enabled(false, Some("1")));
        // env 未设置 → 用配置值。
        assert!(resolve_os_sandbox_enabled(true, None));
        assert!(!resolve_os_sandbox_enabled(false, None));
    }

    #[test]
    fn policy_mapping() {
        assert_eq!(sandbox_policy_for(true), SandboxPolicy::OsSandbox);
        assert_eq!(sandbox_policy_for(false), SandboxPolicy::WorkspaceOnly);
    }
}
