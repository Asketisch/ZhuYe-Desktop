//! 桌面端配置健康提示，基于应用当前生效的配置快照。
//!
//! 口径随上游「模型组是唯一接入单元」对齐：不再看固定的
//! `[anthropic]` / `[openai]` / `[ollama]` 段，只看**模型组**
//! （`[[model_group]]`）。

use serde::{Deserialize, Serialize};
use zhuye_config::{ModelGroupSection, ZhuyeConfig};

/// 配置健康问题的稳定标识与严重程度。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConfigHealthIssue {
    /// 供客户端定位文案和关闭状态的标识。
    pub key: String,
    /// `critical` 表示阻断，`warn` 表示警告。
    pub level: String,
}

/// 定位当前活跃的模型组（按组 id 在 `[[model_group]]` 中查找）。
///
/// `None` = 没有活跃组：既没有 `[active].group`（或它指向不存在的组），
/// 也没有任何带凭据的组可兜底。
fn active_group(config: &ZhuyeConfig) -> Option<&ModelGroupSection> {
    let id = config.active_group()?;
    config
        .model_group
        .iter()
        .find(|group| group.id.trim() == id.trim())
}

/// 模型组是否带了可用凭据。
///
/// 组级 `api_key` 非空，或组内至少有一条凭据条目 —— 二者之一成立即算
/// 「用户已经把这个模型组接进来了」。
fn group_has_credential(group: &ModelGroupSection) -> bool {
    group
        .api_key
        .as_deref()
        .is_some_and(|key| !key.trim().is_empty())
        || !group.credentials.is_empty()
}

/// 从配置快照生成桌面端健康提示。
///
/// `no-provider` 判定（模型组口径）：
/// - **没有活跃组** → 阻断（模型组 id 必须来自已声明的 `[[model_group]]`）；
/// - **活跃组既无组级 `api_key`、也无组内凭据** → 阻断（组声明了但没接
///   上任何凭据，请求必然失败）。
///
/// 键名 `no-provider` 是**稳定标识**（前端 `ConfigHealthKey` 契约按它
/// 取文案），不随口径变化改名；口径变化只体现在判定与本模块文案上。
pub fn config_health_issues(config: &ZhuyeConfig) -> Vec<ConfigHealthIssue> {
    let mut issues = Vec::new();
    let missing_group = match active_group(config) {
        // 活跃组缺凭据 → 同样判为「没接上模型」。
        Some(group) => !group_has_credential(group),
        None => true,
    };
    if missing_group {
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
    fn diagnostics_follow_model_group_semantics() {
        let default = zhuye_config::load_from_str("").expect("默认配置");
        assert_eq!(
            config_health_issues(&default)
                .iter()
                .map(|issue| issue.key.as_str())
                .collect::<Vec<_>>(),
            vec!["no-provider"]
        );

        // 活跃组带组级 api_key → 健康。
        let healthy = zhuye_config::load_from_str(
            "[[model_group]]\nid = \"main\"\nendpoint = \"openai\"\napi_key = \"sk-test\"\n\n\
             [active]\ngroup = \"main\"\n[sandbox]\nos_level = true\n",
        )
        .expect("有效配置");
        assert!(config_health_issues(&healthy).is_empty());

        // 其余两条警告与模型组口径互不影响。
        let disabled = zhuye_config::load_from_str(
            "[[model_group]]\nid = \"main\"\nendpoint = \"openai\"\napi_key = \"sk-test\"\n\n\
             [active]\ngroup = \"main\"\n[prompt_guard]\nenabled = false\n[sandbox]\nos_level = false\n",
        )
        .expect("有效配置");
        assert_eq!(
            config_health_issues(&disabled)
                .iter()
                .map(|issue| issue.key.as_str())
                .collect::<Vec<_>>(),
            vec!["guard-disabled", "sandbox-off"]
        );
    }

    /// 活跃组声明了但既无组级 api_key、也无组内凭据 → 阻断。
    #[test]
    fn active_group_without_credentials_is_blocking() {
        let cfg = zhuye_config::load_from_str(
            "[[model_group]]\nid = \"main\"\nendpoint = \"openai\"\n\n[active]\ngroup = \"main\"\n",
        )
        .expect("有效配置");
        assert_eq!(
            config_health_issues(&cfg)
                .iter()
                .map(|issue| issue.key.as_str())
                .collect::<Vec<_>>(),
            vec!["no-provider"]
        );
    }

    /// 活跃组只有组内凭据条目(无组级 api_key)→ 健康。
    #[test]
    fn active_group_with_credentials_is_healthy() {
        let cfg = zhuye_config::load_from_str(
            "[[model_group]]\nid = \"main\"\nendpoint = \"openai\"\n\n\
             [[model_group.credentials]]\nlabel = \"plan-a\"\napi_key = \"sk-a\"\n\n\
             [active]\ngroup = \"main\"\n",
        )
        .expect("有效配置");
        assert!(config_health_issues(&cfg).is_empty());
    }

    /// `[active].group` 指向未声明的组 → 上游口径是「忽略并继续兜底」
    /// （回落到第一个带凭据的组）—— 健康判定与运行期一致，不误报阻断。
    #[test]
    fn dangling_active_group_falls_back_like_the_runtime() {
        let cfg = zhuye_config::load_from_str(
            "[[model_group]]\nid = \"main\"\nendpoint = \"openai\"\napi_key = \"sk-test\"\n\n\
             [active]\ngroup = \"ghost\"\n",
        )
        .expect("有效配置");
        assert_eq!(
            active_group(&cfg).map(|group| group.id.as_str()),
            Some("main"),
            "悬空 group 应回落到第一个带凭据的组"
        );
        assert!(config_health_issues(&cfg).is_empty());
    }
}
