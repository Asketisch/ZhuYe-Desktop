//! QuotaTracker 构建器 —— 把 config 中声明的 coding plan 配额接线到运行时。
//!
//! "Coding plan"(编码计划订阅,如 GLM Coding Plan / Kimi / MiniMax)在
//! config 里表现为 `[[<provider>.credentials]]` 条目上的可选 `[quota]`
//! 子表。本模块遍历三个 provider 段,收集所有声明了 quota 的凭证,注册到
//! 共享 `QuotaTracker`;tracker 随 `AgentConfig::with_quota_tracker` 进入
//! model_call 节点 —— 调用成功后记录用量,窗口耗尽 → `QuotaExhausted`
//! 事件 + credential 冷却,graph 层自动 failover 到池中下一个凭证。
//!
//! 逻辑与 `zhuye-agent/crates/runtime/reflect-exec/src/runtime_config.rs`
//! 的 `build_quota_tracker` 保持一致(该文件为 headless 参考实现;桌面端
//! 不依赖 reflect-exec,故在此平移)。submodule 不动。

use reflect_llm::SharedQuotaTracker;
use tracing::info;

use crate::state::MinimalAgent;

/// 把 `reflect_config::QuotaSource` 映射为运行时 `QuotaProvider` 实例。
/// 返回 `None` 表示该厂商的用量 API 暂未实现(火山需 AK/SK 签名;
/// Anthropic/OpenAI usage 需 OAuth 凭据)——此时仅做本地 token 统计。
/// `commands/config.rs` 的 `reflect_query_plan_quota` 手动查询也复用此映射。
pub(crate) fn make_provider(
    src: &reflect_config::QuotaSource,
) -> Option<std::sync::Arc<dyn reflect_llm::QuotaProvider>> {
    use reflect_llm::{
        KimiQuotaProvider, MinimaxQuotaProvider, ZenmuxQuotaProvider, ZhipuQuotaProvider,
    };
    use std::sync::Arc as StdArc;
    match src {
        reflect_config::QuotaSource::Kimi => {
            Some(StdArc::new(KimiQuotaProvider) as StdArc<dyn reflect_llm::QuotaProvider>)
        }
        reflect_config::QuotaSource::Zhipu => {
            Some(StdArc::new(ZhipuQuotaProvider) as StdArc<dyn reflect_llm::QuotaProvider>)
        }
        reflect_config::QuotaSource::Minimax => {
            Some(StdArc::new(MinimaxQuotaProvider) as StdArc<dyn reflect_llm::QuotaProvider>)
        }
        reflect_config::QuotaSource::Zenmux => {
            Some(StdArc::new(ZenmuxQuotaProvider) as StdArc<dyn reflect_llm::QuotaProvider>)
        }
        reflect_config::QuotaSource::Volcengine
        | reflect_config::QuotaSource::AnthropicUsage
        | reflect_config::QuotaSource::OpenAIUsage => None,
    }
}

/// 遍历 config 所有 provider 的 credentials,收集声明了 `quota` 的条目并
/// 注册到 `QuotaTracker`。任一 provider 有 quota 声明 → `Some(tracker)`;
/// 全无 → `None`(向后兼容:不配 quota 时零开销)。
pub(crate) fn build_quota_tracker(
    cfg: &reflect_config::ReflectConfig,
) -> Option<SharedQuotaTracker> {
    let tracker = std::sync::Arc::new(reflect_llm::QuotaTracker::new());
    let mut any = false;

    let mut register_provider = |provider: &str, creds: &[reflect_config::CredentialConfig]| {
        for c in creds {
            let Some(q) = &c.quota else { continue };
            let rt_source = q.check_via.as_ref().map(|s| match s {
                reflect_config::QuotaSource::Kimi => reflect_llm::QuotaSource::Kimi,
                reflect_config::QuotaSource::Zhipu => reflect_llm::QuotaSource::Zhipu,
                reflect_config::QuotaSource::Minimax => reflect_llm::QuotaSource::Minimax,
                reflect_config::QuotaSource::Zenmux => reflect_llm::QuotaSource::Zenmux,
                reflect_config::QuotaSource::Volcengine => reflect_llm::QuotaSource::Volcengine,
                reflect_config::QuotaSource::AnthropicUsage => {
                    reflect_llm::QuotaSource::AnthropicUsage
                }
                reflect_config::QuotaSource::OpenAIUsage => reflect_llm::QuotaSource::OpenAIUsage,
            });
            let rt = reflect_llm::QuotaConfig {
                window_secs: q.window_secs,
                max_tokens: q.max_tokens,
                check_via: rt_source,
            };
            tracker.register(provider, &c.label, rt);
            // 注册凭证的 base_url + api_key(厂商用量 API 查询需要)。
            let base_url = c
                .base_url
                .clone()
                .unwrap_or_else(|| format!("https://{provider}"));
            tracker.register_credential(provider, &c.label, &base_url, &c.api_key);
            if let Some(src) = &q.check_via {
                if let Some(p) = make_provider(src) {
                    tracker.register_provider(provider, &c.label, p);
                }
            }
            info!(
                provider,
                label = %c.label,
                window_secs = q.window_secs,
                max_tokens = q.max_tokens,
                has_api = q.check_via.is_some(),
                "registered coding plan quota for credential"
            );
            any = true;
        }
    };

    if let Some(s) = &cfg.anthropic {
        register_provider("anthropic", &s.credentials);
    }
    if let Some(s) = &cfg.openai {
        register_provider("openai", &s.credentials);
    }
    if let Some(s) = &cfg.ollama {
        register_provider("ollama", &s.credentials);
    }
    if any { Some(tracker) } else { None }
}

/// install 阶段调用:构建 tracker 并写入 inner(随 `construct_thread` 进入
/// 每个 AgentConfig)。
pub(crate) fn install_quota_tracker(agent: &MinimalAgent, cfg: &reflect_config::ReflectConfig) {
    let tracker = build_quota_tracker(cfg);
    *agent.inner.quota_tracker.lock() = tracker;
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 无 quota 声明 → None(向后兼容)。
    #[test]
    fn no_quota_section_yields_none() {
        let cfg = reflect_config::load_from_str("").expect("empty config parses");
        assert!(build_quota_tracker(&cfg).is_none());
    }

    /// 带 quota 的 credential → Some(tracker),且 (provider,label) 可追踪;
    /// check_via 指向已实现厂商时,provider 实例也应注册。
    #[test]
    fn quota_section_registers_credential() {
        let toml = r#"
[active]
provider = "anthropic"

[anthropic]
api_key = "sk-top"

[[anthropic.credentials]]
label = "glm-plan"
api_key = "sk-glm"
base_url = "https://open.bigmodel.cn/api/anthropic"

[anthropic.credentials.quota]
window_secs = 3600
max_tokens = 120000
check_via = "zhipu"

[[openai.credentials]]
label = "no-quota"
api_key = "sk-oai"
"#;
        let cfg = reflect_config::load_from_str(toml).expect("config parses");
        let tracker = build_quota_tracker(&cfg).expect("quota declared → tracker");
        assert!(tracker.is_tracked("anthropic", "glm-plan"));
        assert!(
            !tracker.is_tracked("openai", "no-quota"),
            "未声明 quota 的凭证不注册"
        );
    }
}
