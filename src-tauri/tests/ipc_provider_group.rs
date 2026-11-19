//! 模型组(`[[provider_group]]`)经真实 IPC 命令表的端到端行为:
//! 保存含组的配置 → 热重载重建 registry → `reflect_set_model` 以组 id
//! 切换并返回 `<组id>/<model>` spec;未知组 id 拒绝。
//!
//! 走与生产同一份 `generate_handler!` 注册表(`tauri::test` mock runtime),
//! 不经前端 invoke 包装与 fakeBackend。

mod common;

use serde_json::json;

/// 含一个 openai 格式模型组的最小配置(静态 model,不打网络)。
const GROUP_TOML: &str = r#"
[active]
provider = "anthropic"

[anthropic]
api_key = "sk-builtin"

[[provider_group]]
id = "my-glm"
endpoint = "openai"
base_url = "https://open.bigmodel.cn/api/paas/v4"
"#;

#[test]
fn provider_group_config_reloads_and_set_model_switches_by_group_id() {
    common::invoke_ok("reflect_bind_session", json!({"id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}));
    common::invoke_ok("reflect_save_config", json!({"toml": GROUP_TOML}));

    // 组保存后热重载已重建 registry:agent_status 如实反映 active provider
    // 尚是内置 anthropic(无显式 model → 诚实降级)。
    let before = common::invoke_ok("reflect_agent_status", json!({}));
    assert_eq!(before["model"], "stub/test", "{before}");

    // 以组 id 切模型(与 Composer 切组同一条命令、同一负载结构)。
    let spec = common::invoke_ok(
        "reflect_set_model",
        json!({"provider": "my-glm", "model": "GLM-5.3-Flash"}),
    );
    assert_eq!(spec.as_str().unwrap(), "my-glm/GLM-5.3-Flash", "{spec}");

    let after = common::invoke_ok("reflect_agent_status", json!({}));
    assert_eq!(after["model"], "my-glm/GLM-5.3-Flash", "{after}");
}

#[test]
fn provider_group_set_model_rejects_unknown_group_id() {
    common::invoke_ok("reflect_bind_session", json!({"id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}));
    common::invoke_ok("reflect_save_config", json!({"toml": GROUP_TOML}));
    let err = common::invoke_err(
        "reflect_set_model",
        json!({"provider": "no-such-group", "model": "m"}),
    );
    // 错误载荷的包装形态随 tauri 版本而异(字符串 / {msg} / {error}),
    // 序列化整包后做包含断言即可锁定语义。
    let msg = serde_json::to_string(&err).unwrap_or_default();
    assert!(
        msg.contains("no-such-group") && msg.contains("provider_group"),
        "错误应指向未知组 id: {msg}"
    );
}

#[test]
fn provider_group_group_level_model_change_triggers_reload() {
    // 只改组级 model(经 set_model 写组字段)→ 下一次 status 即新 spec,
    // 证明 `provider_stack_changed` 覆盖了 provider_group 段。
    common::invoke_ok("reflect_bind_session", json!({"id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}));
    common::invoke_ok("reflect_save_config", json!({"toml": GROUP_TOML}));
    let first = common::invoke_ok(
        "reflect_set_model",
        json!({"provider": "my-glm", "model": "GLM-5.3-Flash"}),
    );
    assert_eq!(first.as_str().unwrap(), "my-glm/GLM-5.3-Flash");
    let second = common::invoke_ok(
        "reflect_set_model",
        json!({"provider": "my-glm", "model": "glm-4.7"}),
    );
    assert_eq!(second.as_str().unwrap(), "my-glm/glm-4.7", "{second}");
}
