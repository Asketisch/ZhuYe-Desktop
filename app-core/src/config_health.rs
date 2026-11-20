//! 桌面端配置健康提示，基于应用当前生效的配置快照。

use serde::{Deserialize, Serialize};
use zhuye_config::ReflectConfig;

/// 配置健康问题的稳定标识与严重程度。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConfigHealthIssue {
    /// 供客户端定位文案和关闭状态的标识。
    pub key: String,
    /// `critical` 表示阻断，`warn` 表示警告。
    pub level: String,
}

/// 从配置快照生成桌面端健康提示。
pub fn config_health_issues(config: &ReflectConfig) -> Vec<ConfigHealthIssue> {
    let mut issues = Vec::new();
    let nonempty = |value: Option<&str>| value.is_some_and(|text| !text.trim().is_empty());
    let provider = config.active.provider.as_deref();
    let anthropic = config
        .anthropic
        .as_ref()
        .and_then(|value| value.api_key.as_deref());
    let openai = config
        .openai
        .as_ref()
        .and_then(|value| value.api_key.as_deref());
    if !nonempty(provider) && !nonempty(anthropic) && !nonempty(openai) {
        issues.push(ConfigHealthIssue {
            key: "no-provider".into(),
            level: "critical".into(),
        });
    }
    if config.prompt_guard.as_ref().and_then(|value| value.enabled) == Some(false) {
        issues.push(ConfigHealthIssue {
            key: "guard-disabled".into(),
            level: "warn".into(),
        });
    }
    if config.sandbox.os_level == Some(false) {
        issues.push(ConfigHealthIssue {
            key: "sandbox-off".into(),
            level: "warn".into(),
        });
    }
    issues
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostics_preserve_provider_and_explicit_switch_semantics() {
        let default = zhuye_config::load_from_str("").expect("默认配置");
        assert_eq!(
            config_health_issues(&default)
                .iter()
                .map(|issue| issue.key.as_str())
                .collect::<Vec<_>>(),
            vec!["no-provider"]
        );
        let healthy = zhuye_config::load_from_str(
            "[active]\nprovider = 'openai'\n[sandbox]\nos_level = true\n",
        )
        .expect("有效配置");
        assert!(config_health_issues(&healthy).is_empty());
        let disabled = zhuye_config::load_from_str("[anthropic]\napi_key = 'key'\n[prompt_guard]\nenabled = false\n[sandbox]\nos_level = false\n").expect("有效配置");
        assert_eq!(
            config_health_issues(&disabled)
                .iter()
                .map(|issue| issue.key.as_str())
                .collect::<Vec<_>>(),
            vec!["guard-disabled", "sandbox-off"]
        );
    }
}
