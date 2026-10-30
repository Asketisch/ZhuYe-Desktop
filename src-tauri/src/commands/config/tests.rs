use super::*;

/// check_via → provider 映射:已实现四家命中,未实现三家报错。
#[test]
fn check_via_routes_to_provider_or_error() {
    for ok in ["kimi", "zhipu", "minimax", "zenmux"] {
        assert!(
            make_quota_provider(ok).is_ok(),
            "{ok} should map to a provider"
        );
    }
    for unsupported in ["volcengine", "anthropic_usage", "open_a_i_usage"] {
        let Err(err) = make_quota_provider(unsupported) else {
            panic!("{unsupported} should not map to a provider yet");
        };
        assert!(err.msg.contains("not implemented"), "{err:?}");
    }
    // 注意 serde rename_all = "snake_case" 对连续大写逐字母拆词:
    // OpenAIUsage → "open_a_i_usage"(探测确认)。因此 openai_usage /
    // open_ai_usage 等常见拼法都走 unknown 分支被拒绝,防止静默吞错。
    assert!(make_quota_provider("openai_usage").is_err());
    assert!(make_quota_provider("open_ai_usage").is_err());
    assert!(make_quota_provider("").is_err());
    assert!(make_quota_provider("nonsense").is_err());
}

/// 用户真实场景(修复前切换空转的根因):同 provider 两个 plan,
/// 切到带 model 的凭证条目必须写入 `[active].credential` + 条目 model,
/// 并由 `resolved_model_spec()` 解析出该条目的 model。
#[test]
fn apply_model_switch_pins_credential_and_writes_entry_model() {
    let toml = r#"
        [active]
        provider = "anthropic"

        [anthropic]
        api_key = "sk-top"

        [[anthropic.credentials]]
        label = "MiniMax"
        api_key = "sk-mm"
    "#;
    let mut cfg = reflect_config::load_from_str(toml).unwrap();
    apply_model_switch(&mut cfg, "anthropic", "MiniMax-M3", Some("MiniMax")).unwrap();
    assert_eq!(cfg.active.credential.as_deref(), Some("MiniMax"));
    let entry = cfg.anthropic.as_ref().unwrap().credentials[0]
        .model
        .as_deref();
    assert_eq!(entry, Some("MiniMax-M3"));
    // 钉住条目自带 model → spec 解析取条目 model。
    assert_eq!(
        cfg.resolved_model_spec().as_deref(),
        Some("anthropic/MiniMax-M3")
    );
}

/// 切换顶层隐式 plan(credentials 数组无同名条目)→ model 写段级,
/// `[active].credential` 指向 "default"(builder 把顶层 api_key wrap
/// 成 label="default" 的池条目,钉住语义依然成立)。
#[test]
fn apply_model_switch_default_label_falls_back_to_section_model() {
    let toml = r#"
        [active]
        provider = "anthropic"

        [anthropic]
        api_key = "sk-top"
    "#;
    let mut cfg = reflect_config::load_from_str(toml).unwrap();
    apply_model_switch(&mut cfg, "anthropic", "glm-4.6", Some("default")).unwrap();
    assert_eq!(cfg.active.credential.as_deref(), Some("default"));
    assert_eq!(
        cfg.anthropic.as_ref().unwrap().model.as_deref(),
        Some("glm-4.6")
    );
    assert_eq!(
        cfg.resolved_model_spec().as_deref(),
        Some("anthropic/glm-4.6")
    );
}

/// 不传 label(旧调用形态)→ 不钉住,model 写段级。
#[test]
fn apply_model_switch_without_label_is_unpinned_section_model() {
    let toml = r#"
        [active]
        provider = "openai"
    "#;
    let mut cfg = reflect_config::load_from_str(toml).unwrap();
    apply_model_switch(&mut cfg, "openai", "gpt-4o", None).unwrap();
    assert_eq!(cfg.active.credential, None);
    assert_eq!(
        cfg.openai.as_ref().unwrap().model.as_deref(),
        Some("gpt-4o")
    );
}

/// 显式钉住却找不到条目 → 报错(而非静默写一个指向空处的 pin)。
#[test]
fn apply_model_switch_rejects_unknown_label() {
    let toml = r#"
        [active]
        provider = "anthropic"

        [anthropic]
        api_key = "sk-top"
    "#;
    let mut cfg = reflect_config::load_from_str(toml).unwrap();
    let err = apply_model_switch(&mut cfg, "anthropic", "m", Some("ghost")).unwrap_err();
    assert!(err.msg.contains("ghost"), "{err:?}");
}

/// 空 model = 清除:钉住条目仍在(切 plan 本身有效),model 缺失由
/// `resolved_model_spec()` 如实返回 None —— GUI 显示"未配置模型"。
#[test]
fn apply_model_switch_empty_model_clears_override() {
    let toml = r#"
        [active]
        provider = "anthropic"
        credential = "MiniMax"

        [[anthropic.credentials]]
        label = "MiniMax"
        api_key = "sk-mm"
        model = "old-model"
    "#;
    let mut cfg = reflect_config::load_from_str(toml).unwrap();
    apply_model_switch(&mut cfg, "anthropic", "  ", Some("MiniMax")).unwrap();
    assert_eq!(cfg.active.credential.as_deref(), Some("MiniMax"));
    assert_eq!(cfg.anthropic.as_ref().unwrap().credentials[0].model, None);
    assert_eq!(cfg.resolved_model_spec(), None);
}
