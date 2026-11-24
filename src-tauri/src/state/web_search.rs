//! web_search 工具门控与工具级环境变量注入。
//!
//! `web_search` 依赖 Brave Search API key。没有 key 时工具即使注册，
//! 调用也会失败，而且会白白进入模型可见工具表（模型反复尝试、浪费
//! 上下文）。桌面端按配置在**注册阶段**门控：
//!
//! - `[web_search].api_key` 非空白，或进程 `BRAVE_API_KEY` 非空白 → 开门；
//! - 两者都缺 → `BundledToolGates.web_search` 强制关闭，工具不进共享
//!   `ToolRegistry`，模型看不到。
//!
//! 同时把配置里的 key 注入 `AgentConfig.tool_env`，让 `WebSearchTool`
//! 在 `ToolContext.env` 里读到 —— 此前桌面从未注入，配置了 key 也不生效
//! （只有 CLI headless 做了这件事）。

use std::collections::HashMap;

use zhuye_config::ReflectConfig;

/// `WebSearchTool` 读取的进程环境变量名（与上游 headless 同口径）。
pub(crate) const BRAVE_API_KEY_ENV: &str = "BRAVE_API_KEY";

/// 配置里的 key 是否存在且非空白。
fn config_key(cfg: &ReflectConfig) -> Option<&str> {
    cfg.web_search
        .as_ref()
        .and_then(|section| section.api_key.as_deref())
        .map(str::trim)
        .filter(|key| !key.is_empty())
}

/// 判定内核（纯函数，测试注入 env 值，避免改进程环境）。
fn key_configured_with(cfg: &ReflectConfig, env_key: Option<&str>) -> bool {
    config_key(cfg).is_some() || env_key.is_some_and(|key| !key.trim().is_empty())
}

/// web_search 是否具备可用的 API key（配置或进程环境任一）。
pub(crate) fn key_configured(cfg: &ReflectConfig) -> bool {
    let env_key = std::env::var(BRAVE_API_KEY_ENV).ok();
    key_configured_with(cfg, env_key.as_deref())
}

/// 构造线程级工具环境变量（`AgentConfig.tool_env`）。
///
/// 只注入配置里的 key；进程环境本身对工具可见，无需复制一份。
pub(crate) fn tool_env(cfg: &ReflectConfig) -> HashMap<String, String> {
    let mut env = HashMap::new();
    if let Some(key) = config_key(cfg) {
        env.insert(BRAVE_API_KEY_ENV.to_string(), key.to_string());
    }
    env
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg_with_api_key(api_key: Option<&str>) -> ReflectConfig {
        match api_key {
            Some(key) => toml::from_str(&format!("[web_search]\napi_key = \"{key}\"\n")).unwrap(),
            None => ReflectConfig::default(),
        }
    }

    #[test]
    fn no_key_and_no_env_is_closed() {
        let cfg = cfg_with_api_key(None);
        assert!(!key_configured_with(&cfg, None));
        assert!(!key_configured_with(&cfg, Some("   ")));
    }

    #[test]
    fn configured_key_opens_gate_without_env() {
        let cfg = cfg_with_api_key(Some("BSA123"));
        assert!(key_configured_with(&cfg, None));
        assert_eq!(
            tool_env(&cfg).get(BRAVE_API_KEY_ENV).map(String::as_str),
            Some("BSA123")
        );
    }

    #[test]
    fn env_key_opens_gate_without_config() {
        let cfg = cfg_with_api_key(None);
        assert!(key_configured_with(&cfg, Some("from-env")));
        assert!(
            tool_env(&cfg).is_empty(),
            "env 本身可见，不应复制进 tool_env"
        );
    }

    #[test]
    fn blank_configured_key_does_not_open_gate() {
        let cfg = cfg_with_api_key(Some("   "));
        assert!(!key_configured_with(&cfg, None));
        assert!(tool_env(&cfg).is_empty());
    }
}
