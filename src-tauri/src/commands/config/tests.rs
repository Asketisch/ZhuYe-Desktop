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

/// 用户真实场景(修复前切换空转的根因):同模型组两个 plan,
/// 切到带 model 的凭据条目必须写入 `[active].credential` + 条目 model,
/// 并由 `resolved_model_spec()` 解析出该条目的 model。
#[test]
fn apply_model_switch_pins_credential_and_writes_entry_model() {
    let toml = r#"
        [[model_group]]
        id = "anthropic"
        endpoint = "anthropic"
        api_key = "sk-top"

        [[model_group.credentials]]
        label = "MiniMax"
        api_key = "sk-mm"

        [active]
        group = "anthropic"
    "#;
    let mut cfg = zhuye_config::load_from_str(toml).unwrap();
    apply_model_switch(&mut cfg, "anthropic", "MiniMax-M3", Some("MiniMax")).unwrap();
    assert_eq!(cfg.active.group.as_deref(), Some("anthropic"));
    assert_eq!(cfg.active.credential.as_deref(), Some("MiniMax"));
    let entry = cfg.model_group[0].credentials[0].model.as_deref();
    assert_eq!(entry, Some("MiniMax-M3"));
    // 钉住条目自带 model → spec 解析取条目 model。
    assert_eq!(
        cfg.resolved_model_spec().as_deref(),
        Some("anthropic/MiniMax-M3")
    );
}

/// 切换组级隐式凭据(credentials 数组无同名条目)→ model 写组级,
/// `[active].credential` 指向 "default"(builder 把组级 api_key wrap
/// 成 label="default" 的池条目,钉住语义依然成立)。
#[test]
fn apply_model_switch_default_label_falls_back_to_group_model() {
    let toml = r#"
        [[model_group]]
        id = "anthropic"
        endpoint = "anthropic"
        api_key = "sk-top"

        [active]
        group = "anthropic"
    "#;
    let mut cfg = zhuye_config::load_from_str(toml).unwrap();
    apply_model_switch(&mut cfg, "anthropic", "glm-4.6", Some("default")).unwrap();
    assert_eq!(cfg.active.credential.as_deref(), Some("default"));
    assert_eq!(cfg.model_group[0].model.as_deref(), Some("glm-4.6"));
    assert_eq!(
        cfg.resolved_model_spec().as_deref(),
        Some("anthropic/glm-4.6")
    );
}

/// 不传 label(旧调用形态)→ 不钉住,model 写组级。
#[test]
fn apply_model_switch_without_label_is_unpinned_group_model() {
    let toml = r#"
        [[model_group]]
        id = "openai"
        endpoint = "openai"

        [active]
        group = "openai"
    "#;
    let mut cfg = zhuye_config::load_from_str(toml).unwrap();
    apply_model_switch(&mut cfg, "openai", "gpt-4o", None).unwrap();
    assert_eq!(cfg.active.credential, None);
    assert_eq!(cfg.model_group[0].model.as_deref(), Some("gpt-4o"));
    assert_eq!(cfg.resolved_model_spec().as_deref(), Some("openai/gpt-4o"));
}

/// 显式钉住却找不到条目 → 报错(而非静默写一个指向空处的 pin)。
#[test]
fn apply_model_switch_rejects_unknown_label() {
    let toml = r#"
        [[model_group]]
        id = "anthropic"
        endpoint = "anthropic"
        api_key = "sk-top"

        [active]
        group = "anthropic"
    "#;
    let mut cfg = zhuye_config::load_from_str(toml).unwrap();
    let err = apply_model_switch(&mut cfg, "anthropic", "m", Some("ghost")).unwrap_err();
    assert!(err.msg.contains("ghost"), "{err:?}");
}

/// 空 model = 清除:钉住条目仍在(切 plan 本身有效),model 缺失由
/// `resolved_model_spec()` 如实返回 None —— GUI 显示"未配置模型"。
#[test]
fn apply_model_switch_empty_model_clears_override() {
    let toml = r#"
        [[model_group]]
        id = "anthropic"
        endpoint = "anthropic"

        [[model_group.credentials]]
        label = "MiniMax"
        api_key = "sk-mm"
        model = "old-model"

        [active]
        group = "anthropic"
        credential = "MiniMax"
    "#;
    let mut cfg = zhuye_config::load_from_str(toml).unwrap();
    apply_model_switch(&mut cfg, "anthropic", "  ", Some("MiniMax")).unwrap();
    assert_eq!(cfg.active.credential.as_deref(), Some("MiniMax"));
    assert_eq!(cfg.model_group[0].credentials[0].model, None);
    assert_eq!(cfg.resolved_model_spec(), None);
}

/// 模型组切换:`group` = 组 id 时 model 写组级 `model` 字段,
/// `[active].group` 指向该组,spec 解析出 `<组id>/<model>`。
#[test]
fn apply_model_switch_group_writes_group_model() {
    let toml = r#"
        [[model_group]]
        id = "my-glm"
        endpoint = "openai"
        base_url = "https://open.bigmodel.cn/api/paas/v4"
    "#;
    let mut cfg = zhuye_config::load_from_str(toml).unwrap();
    apply_model_switch(&mut cfg, "my-glm", "GLM-5.3-Flash", None).unwrap();
    assert_eq!(cfg.active.group.as_deref(), Some("my-glm"));
    assert_eq!(cfg.active.credential, None);
    assert_eq!(cfg.model_group[0].model.as_deref(), Some("GLM-5.3-Flash"));
    assert_eq!(
        cfg.resolved_model_spec().as_deref(),
        Some("my-glm/GLM-5.3-Flash")
    );
}

/// 模型组 + 钉住组内凭据条目:model 写条目自身(label 命中)。
#[test]
fn apply_model_switch_group_pins_credential_entry_model() {
    let toml = r#"
        [[model_group]]
        id = "my-glm"
        endpoint = "openai"

        [[model_group.credentials]]
        label = "backup"
        api_key = "sk-b"
    "#;
    let mut cfg = zhuye_config::load_from_str(toml).unwrap();
    apply_model_switch(&mut cfg, "my-glm", "GLM-5.3-Flash", Some("backup")).unwrap();
    assert_eq!(cfg.active.credential.as_deref(), Some("backup"));
    assert_eq!(
        cfg.model_group[0].credentials[0].model.as_deref(),
        Some("GLM-5.3-Flash")
    );
    assert_eq!(
        cfg.resolved_model_spec().as_deref(),
        Some("my-glm/GLM-5.3-Flash")
    );
}

/// 模型组显式钉住组内不存在的凭据 → 报错(防 pin 指向空处)。
#[test]
fn apply_model_switch_group_rejects_unknown_label() {
    let toml = r#"
        [[model_group]]
        id = "my-glm"
        endpoint = "openai"
    "#;
    let mut cfg = zhuye_config::load_from_str(toml).unwrap();
    let err = apply_model_switch(&mut cfg, "my-glm", "m", Some("ghost")).unwrap_err();
    assert!(
        err.msg.contains("ghost") && err.msg.contains("model group"),
        "{err:?}"
    );
}

/// 组 id 不存在时 apply_model_switch 直接报错(防御分支;调用方已
/// 做过存在性校验,这里是纯函数层的兜底)。
#[test]
fn apply_model_switch_rejects_missing_group() {
    let toml = r#"
        [[model_group]]
        id = "my-glm"
        endpoint = "openai"
    "#;
    let mut cfg = zhuye_config::load_from_str(toml).unwrap();
    let err = apply_model_switch(&mut cfg, "no-such-group", "m", None).unwrap_err();
    assert!(err.msg.contains("no-such-group"), "{err:?}");
}

/// 空 model 切到组 = 清除组级 model 覆盖(切组本身有效)。
#[test]
fn apply_model_switch_group_empty_model_clears_override() {
    let toml = r#"
        [[model_group]]
        id = "my-glm"
        endpoint = "openai"
        model = "old-model"
    "#;
    let mut cfg = zhuye_config::load_from_str(toml).unwrap();
    apply_model_switch(&mut cfg, "my-glm", "  ", None).unwrap();
    assert_eq!(cfg.model_group[0].model, None);
    assert_eq!(cfg.resolved_model_spec(), None);
}

/// 切组时 `[active].credential` 必须跟着切换 —— 旧组的钉住不能泄漏到
/// 新组(否则新组找不到同名条目,钉住静默悬空)。
#[test]
fn apply_model_switch_clears_credential_pin_when_label_omitted() {
    let toml = r#"
        [[model_group]]
        id = "group-a"
        endpoint = "openai"

        [[model_group.credentials]]
        label = "plan-a"
        api_key = "sk-a"

        [[model_group]]
        id = "group-b"
        endpoint = "openai"

        [active]
        group = "group-a"
        credential = "plan-a"
    "#;
    let mut cfg = zhuye_config::load_from_str(toml).unwrap();
    apply_model_switch(&mut cfg, "group-b", "b-model", None).unwrap();
    assert_eq!(cfg.active.group.as_deref(), Some("group-b"));
    assert_eq!(cfg.active.credential, None, "切组不传 label → 不钉凭据");
    assert_eq!(cfg.model_group[1].model.as_deref(), Some("b-model"));
}
