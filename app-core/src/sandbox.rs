//! OS 沙箱策略解析 —— 把「配置里的旋钮」翻译成「每轮真正生效的策略」。
//!
//! ## 为什么需要
//!
//! 核心的 OS 沙箱有**三条**来源，桌面端此前一条都没接上：
//!
//! | 来源 | 语义 | 桌面端此前 |
//! |---|---|---|
//! | 配置 `[sandbox].os_level` | 用户意图（bool） | ✗ 只写盘，不生效 |
//! | 协议 `ThreadSettingsOverrides.sandbox_policy` | 每轮覆盖 → `ToolContext.os_sandbox` | ✗ 从不设置 |
//! | env `REFLECT_SANDBOX_OS_LEVEL` | 进程级开关 | ✗ 从不读 |
//!
//! 结果是 GUI 的开关是**死旋钮**：Settings 里写 `os_level = false`，
//! bash 仍跑在 Seatbelt 里（核心 `OsSandbox::from_env()` 在 env 未设置时
//! **默认开启**），而状态栏显示的又是 env 推导出来的状态 —— 两边说的
//! 不是一回事。
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
//!   `SandboxSection::os_level` 是 `#[derive(Default)]` 的 `bool`
//!   （缺省 `false`），**没有 `Option<bool>`**，所以「用户没写」与
//!   「用户写了 false」在解析后不可区分 —— 若照字面执行，全员默认
//!   关闭 OS 沙箱，比 CLI 的实际行为更不安全。
//!   → 本模块用**原始 TOML** 判断 key 是否存在（见
//!   [`SandboxOsLevelIntent`]），把「没表态」归一到基线开启。
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

/// 配置里 `[sandbox].os_level` 的**表态**。
///
/// 核心 schema 用 `bool` + `#[serde(default)]`，解析后无法区分
/// 「用户没写」与「用户写了 false」。本枚举在**原始 TOML** 层面保留
/// 这个区分。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SandboxOsLevelIntent {
    /// 配置里显式写了 `os_level = <bool>` —— 尊重用户的显式表态。
    Explicit(bool),
    /// 配置里没有这个 key —— 用户未表态，走核心基线（开启）。
    Unset,
}

/// 从原始 TOML 判断 `[sandbox].os_level` 是否被显式写过。
///
/// TOML 解析失败 → 按 [`SandboxOsLevelIntent::Unset`] 处理（交由调用方
/// 走基线），不因为一份坏 TOML 把沙箱关掉。
pub fn sandbox_intent_from_toml(raw: &str) -> SandboxOsLevelIntent {
    let Ok(value) = raw.parse::<toml::Value>() else {
        return SandboxOsLevelIntent::Unset;
    };
    let Some(section) = value.get("sandbox") else {
        return SandboxOsLevelIntent::Unset;
    };
    let Some(os_level) = section.get("os_level") else {
        return SandboxOsLevelIntent::Unset;
    };
    match os_level.as_bool() {
        Some(b) => SandboxOsLevelIntent::Explicit(b),
        // 类型不对（非 bool）→ 视为未表态，走基线。
        None => SandboxOsLevelIntent::Unset,
    }
}

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
/// 未表态 → `true`（核心基线：默认要求 OS sandbox）；显式值 → 原样。
pub fn normalize_os_level(intent: SandboxOsLevelIntent) -> bool {
    match intent {
        SandboxOsLevelIntent::Explicit(on) => on,
        SandboxOsLevelIntent::Unset => true,
    }
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
/// 归一后，内存里的 `cfg.sandbox.os_level` 就是**用户意图**（未表态 =
/// 基线开启），Settings 的开关与状态栏显示的策略因此一致。
///
/// 注：env 覆盖**不在这里**生效 —— env 是进程级逃生口，在真正决定
/// 每轮策略时（[`resolve_os_sandbox_enabled`]）才叠加，避免把「临时
/// 覆盖」烤进配置快照。
pub fn load_config_with_sandbox_baseline() -> reflect_config::ReflectConfig {
    let mut cfg = reflect_config::load_default();
    let intent = match reflect_config::default_config_path() {
        Some(path) => match std::fs::read_to_string(&path) {
            Ok(raw) => sandbox_intent_from_toml(&raw),
            Err(_) => SandboxOsLevelIntent::Unset,
        },
        None => SandboxOsLevelIntent::Unset,
    };
    cfg.sandbox.os_level = normalize_os_level(intent);
    cfg
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn intent_detects_explicit_value() {
        assert_eq!(
            sandbox_intent_from_toml("[sandbox]\nos_level = false\n"),
            SandboxOsLevelIntent::Explicit(false)
        );
        assert_eq!(
            sandbox_intent_from_toml("[sandbox]\nos_level = true\n"),
            SandboxOsLevelIntent::Explicit(true)
        );
    }

    #[test]
    fn intent_is_unset_when_key_absent() {
        assert_eq!(
            sandbox_intent_from_toml("[sandbox]\nallow_network = true\n"),
            SandboxOsLevelIntent::Unset
        );
        assert_eq!(
            sandbox_intent_from_toml("[active]\nprovider = \"openai\"\n"),
            SandboxOsLevelIntent::Unset
        );
        assert_eq!(sandbox_intent_from_toml(""), SandboxOsLevelIntent::Unset);
    }

    #[test]
    fn intent_is_unset_on_broken_toml() {
        // 坏 TOML 不应把沙箱关掉 —— 交给基线。
        assert_eq!(
            sandbox_intent_from_toml("[sandbox\nos_level = false"),
            SandboxOsLevelIntent::Unset
        );
    }

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
    fn unset_intent_follows_core_baseline() {
        // 未表态 → 基线开启（核心 OsSandbox::default() = enabled + strict）。
        assert!(normalize_os_level(SandboxOsLevelIntent::Unset));
    }

    #[test]
    fn explicit_false_disables() {
        assert!(!normalize_os_level(SandboxOsLevelIntent::Explicit(false)));
        assert!(normalize_os_level(SandboxOsLevelIntent::Explicit(true)));
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
