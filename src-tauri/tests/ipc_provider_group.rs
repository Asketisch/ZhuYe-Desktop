//! 模型组(`[[model_group]]`)经真实 IPC 命令表的端到端行为:
//! 保存含组的配置 → 热重载重建 registry → `zhuye_set_model` 以组 id
//! 切换并返回 `<组id>/<model>` spec;未知组 id 拒绝。
//!
//! 走与生产同一份 `generate_handler!` 注册表(`tauri::test` mock runtime),
//! 不经前端 invoke 包装与 fakeBackend。
//!
//! **同一测试二进制共用一个 app**(见 `tests/common/mod.rs`)—— 改配置的
//! 用例必须持 `state_lock`,否则并行跑时彼此的 `zhuye_save_config` 会
//! 互相覆盖,断言读到别人的配置。

mod common;

use serde_json::json;

/// 含一个 openai 格式模型组的最小配置(静态 model,不打网络)。
const GROUP_TOML: &str = r#"
[[model_group]]
id = "my-glm"
endpoint = "openai"
base_url = "https://open.bigmodel.cn/api/paas/v4"
"#;

/// 同一组 + 一条组内凭据(测「钉住组内凭据」)。
const GROUP_WITH_CREDENTIAL_TOML: &str = r#"
[[model_group]]
id = "my-glm"
endpoint = "openai"
base_url = "https://open.bigmodel.cn/api/paas/v4"

[[model_group.credentials]]
label = "backup"
api_key = "sk-backup"
"#;

#[test]
fn provider_group_config_reloads_and_set_model_switches_by_group_id() {
    let _state = common::state_lock();
    common::invoke_ok(
        "zhuye_bind_session",
        json!({"id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}),
    );
    common::invoke_ok("zhuye_save_config", json!({"toml": GROUP_TOML}));

    // 组保存后热重载已重建 registry:agent_status 如实反映活跃组
    // 尚无显式 model → 诚实降级(stub)。
    let before = common::invoke_ok("zhuye_agent_status", json!({}));
    assert_eq!(before["model"], "stub/test", "{before}");

    // 以组 id 切模型(与 Composer 切组同一条命令、同一负载结构)。
    let spec = common::invoke_ok(
        "zhuye_set_model",
        json!({"group": "my-glm", "model": "GLM-5.3-Flash"}),
    );
    assert_eq!(spec.as_str().unwrap(), "my-glm/GLM-5.3-Flash", "{spec}");

    let after = common::invoke_ok("zhuye_agent_status", json!({}));
    assert_eq!(after["model"], "my-glm/GLM-5.3-Flash", "{after}");
}

#[test]
fn provider_group_set_model_rejects_unknown_group_id() {
    let _state = common::state_lock();
    common::invoke_ok(
        "zhuye_bind_session",
        json!({"id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}),
    );
    common::invoke_ok("zhuye_save_config", json!({"toml": GROUP_TOML}));
    let err = common::invoke_err(
        "zhuye_set_model",
        json!({"group": "no-such-group", "model": "m"}),
    );
    // 错误载荷的包装形态随 tauri 版本而异(字符串 / {msg} / {error}),
    // 序列化整包后做包含断言即可锁定语义。
    let msg = serde_json::to_string(&err).unwrap_or_default();
    assert!(
        msg.contains("no-such-group") && msg.contains("model_group"),
        "错误应指向未知模型组 id: {msg}"
    );
}

#[test]
fn provider_group_group_level_model_change_triggers_reload() {
    let _state = common::state_lock();
    // 只改组级 model(经 set_model 写组字段)→ 下一次 status 即新 spec,
    // 证明 `provider_stack_changed` 覆盖了 model_group 段。
    common::invoke_ok(
        "zhuye_bind_session",
        json!({"id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}),
    );
    common::invoke_ok("zhuye_save_config", json!({"toml": GROUP_TOML}));
    let first = common::invoke_ok(
        "zhuye_set_model",
        json!({"group": "my-glm", "model": "GLM-5.3-Flash"}),
    );
    assert_eq!(first.as_str().unwrap(), "my-glm/GLM-5.3-Flash");
    let second = common::invoke_ok(
        "zhuye_set_model",
        json!({"group": "my-glm", "model": "glm-4.7"}),
    );
    assert_eq!(second.as_str().unwrap(), "my-glm/glm-4.7", "{second}");
}

/// 钉住组内凭据条目:model 写条目自身,`[active].credential` 钉住该条目。
#[test]
fn provider_group_set_model_pins_group_credential() {
    let _state = common::state_lock();
    common::invoke_ok(
        "zhuye_bind_session",
        json!({"id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}),
    );
    common::invoke_ok(
        "zhuye_save_config",
        json!({"toml": GROUP_WITH_CREDENTIAL_TOML}),
    );
    let spec = common::invoke_ok(
        "zhuye_set_model",
        json!({"group": "my-glm", "model": "glm-4.7", "label": "backup"}),
    );
    assert_eq!(spec.as_str().unwrap(), "my-glm/glm-4.7", "{spec}");
    // 落盘的配置里钉住了该条目,且 model 写在条目自身。
    let toml = common::invoke_ok("zhuye_get_config", json!({}));
    let text = toml.as_str().unwrap_or_default();
    assert!(text.contains("credential = \"backup\""), "{text}");
}

/// 显式钉住组内不存在的条目 → 报错(防 pin 指向空处)。
#[test]
fn provider_group_set_model_rejects_unknown_credential_label() {
    let _state = common::state_lock();
    common::invoke_ok(
        "zhuye_bind_session",
        json!({"id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}),
    );
    common::invoke_ok("zhuye_save_config", json!({"toml": GROUP_TOML}));
    let err = common::invoke_err(
        "zhuye_set_model",
        json!({"group": "my-glm", "model": "m", "label": "ghost"}),
    );
    let msg = serde_json::to_string(&err).unwrap_or_default();
    assert!(msg.contains("ghost"), "错误应指出未知的凭据 label: {msg}");
}
