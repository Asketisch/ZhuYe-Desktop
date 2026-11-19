//! model spec 解析专题（自 `agent.rs` 拆出，文件预算棘轮）：
//! 降级原因计算 + 显式解析兜底 + 动态清单发现。消费方 `install.rs` /
//! `reload.rs`（`super::model_spec::` 路径）。

use reflect_config::ReflectConfig;
use reflect_llm::ModelRegistry;

/// 按配置快照计算降级原因(供 install / 热重载共用)。
///
/// 两级缺失分开报:无 provider(没 key)与「有 provider 但没 model」。
/// 上游 model 解析诚实化后,后者不再编造默认模型名 —— 状态栏如实显示
/// "未配置模型",这里给出可行动的指引。
pub(crate) fn compute_degraded_reason(cfg: &ReflectConfig) -> Option<String> {
    if cfg.active_provider().is_none() {
        return Some("no provider configured — set an API key in Settings".to_string());
    }
    // 与 spec 兜底同口径:兜底能解析出可用凭证就不算降级,否则配置里
    // 明明有可用凭证、状态栏却挂着"未配置模型"的误导性黄点。
    if resolve_model_spec_with_fallback(cfg).is_none() {
        return Some(
            "provider configured but no model — pick a plan/model in Settings → Models".to_string(),
        );
    }
    None
}

/// 显式 model spec 解析(env > 钉住条目 > 段级)失败时的兜底:回退到
/// active provider 下**第一个带 model 的凭证条目**。
///
/// 为什么需要:`[active].credential` 可能悬空指向不存在的条目(配置手改 /
/// 凭证 label 改名后残留,如 `"default"` vs 池里的 `"MiniMax"`),显式链
/// 返回 None,调用方此前直接落 `"stub/test"` → 路由池没有 stub provider →
/// 每次请求报 `ALL_CREDENTIALS_EXHAUSTED (0 tried)`,而池里明明有可用
/// 凭证。这里与 `next_for` 对悬空 preferred 的「静默回落轮询」语义对齐:
/// 有可用凭证就照常跑,不把可自愈的配置问题放大成硬故障。
pub(crate) fn resolve_model_spec_with_fallback(cfg: &ReflectConfig) -> Option<String> {
    if let Some(spec) = cfg.resolved_model_spec() {
        return Some(spec);
    }
    let provider = cfg.active_provider()?;
    let creds = match provider.as_str() {
        "anthropic" => cfg.anthropic.as_ref().map(|s| &s.credentials),
        "openai" => cfg.openai.as_ref().map(|s| &s.credentials),
        "ollama" => cfg.ollama.as_ref().map(|s| &s.credentials),
        // 模型组:按组 id 查组内凭据(与引擎 credentials_of 同口径)。
        _ => cfg
            .provider_group
            .iter()
            .find(|g| g.id.trim() == provider)
            .map(|g| &g.credentials),
    }?;
    let model = creds
        .iter()
        .find(|c| c.model.as_deref().is_some_and(|m| !m.trim().is_empty()))
        .and_then(|c| c.model.as_deref())
        .map(str::trim)?;
    Some(format!("{provider}/{model}"))
}

/// 解析 model spec —— **支持运行时才知道的动态值**(`model = "free"`)。
///
/// 上游 `reflect_config::resolve_model_spec` 是统一入口:静态 model 走同步
/// 解析,动态值走 provider 模型清单发现(需要网络 → 必须 async)。桌面端
/// 此前只用同步的 `resolved_model_spec()`,遇到 `model = "free"` 拿到的是
/// **占位串** `"provider/free"` —— 它会被 routing 的 main slot 当成真模型
/// 发给 provider(表现为「模型不存在」),状态栏也显示一个不存在的模型。
///
/// 返回 `(spec, error)`:
/// - `(Some(spec), None)` —— 解析成功,`spec` 是完整的 `"provider/model"`;
/// - `(None, Some(reason))` —— 动态解析失败(清单端点不可达 / 没有免费
///   模型 / `[model_discovery] enabled = false`)。**如实上报**:
///   调用方负责保留旧 model(热重载)或标记降级(安装),不静默回落到占位串;
/// - `(None, None)` —— 配置里确实没有 model(与同步路径同口径)。
///
/// 静态路径的兜底(悬空 credential 钉住 → 第一个带 model 的凭证条目)
/// 仍由 [`resolve_model_spec_with_fallback`] 承担。
pub(crate) async fn resolve_model_spec_with_discovery(
    cfg: &ReflectConfig,
    registry: &ModelRegistry,
) -> (Option<String>, Option<String>) {
    match reflect_config::resolve_model_spec(cfg, registry).await {
        Ok(Some(spec)) => (Some(spec), None),
        // 静态路径解析不出来 → 交给同步兜底(悬空钉住场景)。
        Ok(None) => (resolve_model_spec_with_fallback(cfg), None),
        Err(e) => (None, Some(format!("{e:#}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use reflect_llm::ModelRegistry;

    /// 静态 model:走同步解析路径,不触发清单发现(不打网络)。
    #[tokio::test]
    async fn discovery_resolution_keeps_static_path() {
        let cfg = reflect_config::load_from_str(
            "[active]\nprovider = \"openai\"\n\n[openai]\nmodel = \"gpt-4o\"\n",
        )
        .unwrap();
        let registry = ModelRegistry::new();
        let (spec, err) = resolve_model_spec_with_discovery(&cfg, &registry).await;
        assert_eq!(spec.as_deref(), Some("openai/gpt-4o"));
        assert!(err.is_none(), "静态路径不该报错");
    }

    /// `model = "free"` + 发现开关关闭 → **如实报错**,绝不返回占位串。
    ///
    /// 这条用例锁住本函数存在的理由:同步的 `resolved_model_spec()` 对
    /// `model = "free"` 返回的是占位串 `"openai/free"` —— 它会被当成真
    /// 模型发给 provider(表现为「模型不存在」)。
    #[tokio::test]
    async fn discovery_resolution_reports_error_instead_of_placeholder() {
        let cfg = reflect_config::load_from_str(
            "[active]\nprovider = \"openai\"\n\n[openai]\nmodel = \"free\"\n\n\
             [model_discovery]\nenabled = false\n",
        )
        .unwrap();
        // 旧(同步)行为:占位串 —— 正是要绕开的东西。
        assert_eq!(cfg.resolved_model_spec().as_deref(), Some("openai/free"));

        let registry = ModelRegistry::new();
        let (spec, err) = resolve_model_spec_with_discovery(&cfg, &registry).await;
        assert!(spec.is_none(), "解析失败不得返回占位串");
        let err = err.expect("解析失败必须如实上报");
        assert!(
            err.contains("model_discovery") || err.contains("free"),
            "错误原因应指向发现开关 / free 值,实际: {err}"
        );
    }

    /// `model = "free"` + 发现开着但 provider 没有注册凭据 → 报错
    /// (清单拿不到),同样不返回占位串。
    #[tokio::test]
    async fn discovery_resolution_errors_without_registered_credentials() {
        let cfg = reflect_config::load_from_str(
            "[active]\nprovider = \"openai\"\n\n[openai]\nmodel = \"free\"\n",
        )
        .unwrap();
        let registry = ModelRegistry::new();
        let (spec, err) = resolve_model_spec_with_discovery(&cfg, &registry).await;
        assert!(spec.is_none());
        assert!(err.is_some(), "无凭据 → 清单拉不到 → 如实报错");
    }

    /// 没配 model 时:既没有 spec 也没有错误(与同步路径同口径)。
    #[tokio::test]
    async fn discovery_resolution_without_model_is_silent() {
        let cfg = reflect_config::load_from_str("[active]\nprovider = \"openai\"\n").unwrap();
        let registry = ModelRegistry::new();
        let (spec, err) = resolve_model_spec_with_discovery(&cfg, &registry).await;
        assert!(spec.is_none());
        assert!(err.is_none(), "没配 model 不是错误,是缺省");
    }

    /// 悬空钉住(`[active].credential` 指向不存在的 label)+ 凭证条目带
    /// model → 兜底回退到第一个带 model 的凭证,spec 不再落 stub/test。
    /// 这是 `ALL_CREDENTIALS_EXHAUSTED (0 tried)` 的根因回归测试。
    #[test]
    fn spec_fallback_recovers_from_dangling_credential_pin() {
        let toml = r#"
            [active]
            provider = "anthropic"
            credential = "default"

            [anthropic]
            base_url = "https://api.minimaxi.com/anthropic"

            [[anthropic.credentials]]
            label = "MiniMax"
            api_key = "sk-test"
            base_url = "https://api.minimaxi.com/anthropic"
            model = "MiniMax-M3"
            weight = 1
        "#;
        let cfg = reflect_config::load_from_str(toml).unwrap();
        // 显式链确实为 None(钉住 label 不存在 + 无段级 model)。
        assert_eq!(cfg.resolved_model_spec(), None);
        assert_eq!(
            resolve_model_spec_with_fallback(&cfg).as_deref(),
            Some("anthropic/MiniMax-M3")
        );
        // 有可用凭证 → 不再判定降级。
        assert_eq!(compute_degraded_reason(&cfg), None);
    }

    /// 显式链可用时兜底不干预(钉住条目 model 优先,env > 钉住 > 段级)。
    #[test]
    fn spec_fallback_prefers_explicit_resolution() {
        let toml = r#"
            [active]
            provider = "anthropic"
            credential = "MiniMax"

            [anthropic]
            model = "section-model"

            [[anthropic.credentials]]
            label = "MiniMax"
            api_key = "sk-test"
            model = "MiniMax-M3"
        "#;
        let cfg = reflect_config::load_from_str(toml).unwrap();
        assert_eq!(
            resolve_model_spec_with_fallback(&cfg).as_deref(),
            Some("anthropic/MiniMax-M3")
        );
    }

    /// 凭证条目全部无 model(且无段级 model)→ 兜底也 None,保持诚实降级。
    #[test]
    fn spec_fallback_returns_none_without_any_model() {
        let toml = r#"
            [active]
            provider = "anthropic"

            [anthropic]
            api_key = "sk-test"

            [[anthropic.credentials]]
            label = "a"
            api_key = "sk-a"
        "#;
        let cfg = reflect_config::load_from_str(toml).unwrap();
        assert_eq!(resolve_model_spec_with_fallback(&cfg), None);
        assert!(compute_degraded_reason(&cfg).is_some());
    }
}
