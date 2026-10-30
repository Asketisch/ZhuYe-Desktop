mod common;

use serde_json::json;

#[test]
fn hook_commands_control_the_live_engine_and_survive_rebind() {
    common::set_config_before_install("[hooks]\nenabled = [\"search_budget\"]\n");
    let events = common::invoke_ok("reflect_list_hook_events", json!({}));
    let events = events.as_array().unwrap();
    for name in [
        "post_tool_use",
        "post_tool_use_failure",
        "session_start",
        "session_end",
        "post_compact",
        "task_created",
        "task_completed",
        "task_updated",
    ] {
        let event = events.iter().find(|event| event["kind"] == name).unwrap();
        assert!(
            event["decisions"].as_array().unwrap().is_empty(),
            "{name} is notification-only"
        );
    }
    let pre = events
        .iter()
        .find(|event| event["kind"] == "pre_tool_use")
        .unwrap();
    assert!(
        pre["decisions"]
            .as_array()
            .unwrap()
            .contains(&json!("deny"))
    );
    let list = common::invoke_ok("reflect_list_hooks", json!({}));
    let hooks = list.as_array().unwrap();
    assert_eq!(hooks.len(), 1);
    assert_eq!(hooks[0]["name"], "search_budget");
    assert_eq!(hooks[0]["enabled"], true);
    common::invoke_err(
        "reflect_toggle_hook",
        json!({ "name": "not_registered", "enabled": false }),
    );
    common::invoke_ok(
        "reflect_toggle_hook",
        json!({ "name": "search_budget", "enabled": false }),
    );
    let list = common::invoke_ok("reflect_list_hooks", json!({}));
    assert_eq!(list[0]["enabled"], false);
    common::invoke_ok(
        "reflect_bind_session",
        json!({ "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    );
    let after = common::invoke_ok("reflect_list_hooks", json!({}));
    assert_eq!(after[0]["name"], "search_budget");
    assert_eq!(after[0]["enabled"], false);
    common::invoke_ok(
        "reflect_toggle_hook",
        json!({ "name": "search_budget", "enabled": true }),
    );
    assert_eq!(
        common::invoke_ok("reflect_list_hooks", json!({}))[0]["enabled"],
        true
    );
    common::invoke_ok(
        "reflect_save_config",
        json!({ "toml": "[hooks]\nenabled = [\"test_runner\"]\n" }),
    );
    let reconfigured = common::invoke_ok("reflect_list_hooks", json!({}));
    assert_eq!(reconfigured.as_array().unwrap().len(), 1);
    assert_eq!(reconfigured[0]["name"], "test_runner");
    assert_eq!(reconfigured[0]["enabled"], true);

    // 真插件的任务 hook 经 IPC 触发，并随线程重绑和启停同步。
    #[cfg(unix)]
    {
        let fixture = tempfile::tempdir().unwrap();
        let marker = fixture.path().join("task-events.log");
        let starts = fixture.path().join("session-starts.log");
        let ends = fixture.path().join("session-ends.log");
        let prompt = fixture.path().join("first-prompt.json");
        std::fs::write(
            fixture.path().join("plugin.toml"),
            "name = \"task-probe\"\nversion = \"1.0.0\"\nhooks = \"./hooks.json\"\ncommands = \"./commands\"\n",
        )
        .unwrap();
        std::fs::create_dir_all(fixture.path().join("commands")).unwrap();
        std::fs::write(
            fixture.path().join("commands/hello.md"),
            "expanded greeting $ARGUMENTS\n",
        )
        .unwrap();
        let command = format!("printf 'hit\\n' >> '{}'", marker.display());
        let start_command = format!("printf 'start\\n' >> '{}'", starts.display());
        let end_command = format!("printf 'end\\n' >> '{}'", ends.display());
        let prompt_command = format!(
            "cat > '{}'; printf '%s' '{{\"decision\":\"deny\",\"reason\":\"fixture\"}}'",
            prompt.display()
        );
        std::fs::write(fixture.path().join("hooks.json"), json!({ "hooks": { "TaskCreated": [{ "hooks": [{ "type": "command", "command": command }] }], "SessionStart": [{ "hooks": [{ "type": "command", "command": start_command }] }], "SessionEnd": [{ "hooks": [{ "type": "command", "command": end_command }] }], "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": prompt_command }] }] } }).to_string()).unwrap();
        common::invoke_ok(
            "reflect_install_plugin",
            json!({ "path": fixture.path(), "marketplace": "localtest", "scope": "user" }),
        );
        assert!(common::invoke_ok("reflect_list_plugins", json!({}))[0]["runtime"].is_null());
        common::invoke_ok(
            "reflect_toggle_plugin",
            json!({ "id": "task-probe@localtest", "enabled": true }),
        );
        let plugin = &common::invoke_ok("reflect_list_plugins", json!({}))[0];
        assert_eq!(plugin["runtime"]["plugin"], "task-probe@localtest");
        assert_eq!(plugin["runtime"]["command_count"], 1);
        common::invoke_ok(
            "reflect_toggle_plugin",
            json!({ "id": "task-probe@localtest", "enabled": false }),
        );
        assert!(common::invoke_ok("reflect_list_plugins", json!({}))[0]["runtime"].is_null());
        let manifest =
            std::path::PathBuf::from(plugin["installPath"].as_str().unwrap()).join("plugin.toml");
        let original_manifest = std::fs::read(&manifest).unwrap();
        std::fs::write(&manifest, "invalid = [").unwrap();
        common::invoke_ok(
            "reflect_toggle_plugin",
            json!({ "id": "task-probe@localtest", "enabled": true }),
        );
        let failed = &common::invoke_ok("reflect_list_plugins", json!({}))[0];
        assert_eq!(failed["enabled"], true);
        assert!(
            failed["runtime"].is_null(),
            "failed load must not reuse an earlier success"
        );
        std::fs::write(manifest, original_manifest).unwrap();
        common::invoke_ok(
            "reflect_toggle_plugin",
            json!({ "id": "task-probe@localtest", "enabled": false }),
        );
        common::invoke_ok(
            "reflect_toggle_plugin",
            json!({ "id": "task-probe@localtest", "enabled": true }),
        );
        assert_eq!(
            common::invoke_ok("reflect_list_plugins", json!({}))[0]["runtime"]["command_count"],
            1
        );
        common::invoke_ok(
            "reflect_save_config",
            json!({ "toml": "[hooks]\nenabled = [\"test_runner\"]\n[plugins]\nenabled_plugins = []\n" }),
        );
        assert!(common::invoke_ok("reflect_list_plugins", json!({}))[0]["runtime"].is_null());
        common::invoke_ok(
            "reflect_save_config",
            json!({ "toml": "[hooks]\nenabled = [\"test_runner\"]\n[plugins]\nenabled_plugins = [\"task-probe@localtest\"]\n" }),
        );
        assert_eq!(
            common::invoke_ok("reflect_list_plugins", json!({}))[0]["runtime"]["command_count"],
            1
        );
        let commands = common::invoke_ok("reflect_list_plugin_commands", json!({}));
        assert!(
            commands
                .as_array()
                .unwrap()
                .iter()
                .any(|command| command["name"] == "task-probe:hello"),
            "newly installed plugin must load in the current session: {commands}"
        );
        common::invoke_ok(
            "reflect_save_config",
            json!({ "toml": "[hooks]\nenabled = [\"test_runner\"]\n[plugins]\nenabled_plugins = [\"Task-Probe@localtest\", \"task-probe@localtest\"]\n" }),
        );
        let alias = &common::invoke_ok("reflect_list_plugins", json!({}))[0];
        assert_eq!(alias["enabled"], true);
        assert_eq!(alias["runtime"]["plugin"], "task-probe@localtest");
        common::invoke_ok(
            "reflect_toggle_plugin",
            json!({ "id": "task-probe@localtest", "enabled": false }),
        );
        let disabled = &common::invoke_ok("reflect_list_plugins", json!({}))[0];
        assert_eq!(disabled["enabled"], false);
        assert!(disabled["runtime"].is_null());
        common::invoke_ok(
            "reflect_toggle_plugin",
            json!({ "id": "task-probe@localtest", "enabled": true }),
        );
        common::invoke_ok(
            "reflect_bind_session",
            json!({ "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
        );
        common::invoke_ok(
            "reflect_submit",
            json!({ "submission": { "id": "first-plugin-input", "op": { "type": "user_input", "items": [{ "type": "text", "text": "/task-probe:hello world" }] } } }),
        );
        let prompt_event: serde_json::Value = (0..100)
            .find_map(|_| {
                let event = std::fs::read(&prompt)
                    .ok()
                    .and_then(|bytes| serde_json::from_slice(&bytes).ok());
                if event.is_none() {
                    std::thread::sleep(std::time::Duration::from_millis(25));
                }
                event
            })
            .expect("first prompt must reach the mounted plugin hook");
        assert_eq!(prompt_event["text"], "expanded greeting world");
        let hook_name = (0..100)
            .find_map(|_| {
                let hooks = common::invoke_ok("reflect_list_hooks", json!({}));
                let name = hooks
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|hook| {
                        hook["name"]
                            .as_str()
                            .unwrap_or_default()
                            .starts_with("plugin:task-probe@localtest:TaskCreated#")
                    })
                    .and_then(|hook| hook["name"].as_str())
                    .map(str::to_owned);
                if name.is_none() {
                    std::thread::sleep(std::time::Duration::from_millis(25));
                }
                name
            })
            .expect("plugin task hook must be mounted");
        let started = (0..100).any(|_| {
            let count = std::fs::read_to_string(&starts)
                .unwrap_or_default()
                .lines()
                .count();
            if count == 0 {
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            count == 1
        });
        assert!(
            started,
            "session start hook must run once after plugin mount"
        );
        common::invoke_ok(
            "reflect_create_task",
            json!({ "list": "hook-probe", "subject": "first", "description": "" }),
        );
        assert_eq!(std::fs::read_to_string(&marker).unwrap().lines().count(), 1);
        common::invoke_ok(
            "reflect_toggle_hook",
            json!({ "name": hook_name, "enabled": false }),
        );
        let preferences = std::path::PathBuf::from(std::env::var_os("HOME").unwrap())
            .join(".zhuye/hook_state.json");
        let saved_preferences = std::fs::read(&preferences).unwrap();
        std::fs::write(&preferences, "invalid json").unwrap();
        common::invoke_err(
            "reflect_toggle_plugin",
            json!({ "id": "task-probe@localtest", "enabled": false }),
        );
        assert!(
            common::invoke_ok("reflect_list_plugin_commands", json!({}))
                .as_array()
                .unwrap()
                .is_empty(),
            "failed preference restore must unload plugins"
        );
        assert!(common::invoke_ok("reflect_list_plugins", json!({}))[0]["runtime"].is_null());
        std::fs::write(&preferences, saved_preferences).unwrap();
        common::invoke_ok(
            "reflect_toggle_plugin",
            json!({ "id": "task-probe@localtest", "enabled": true }),
        );
        let hooks = common::invoke_ok("reflect_list_hooks", json!({}));
        assert!(
            hooks
                .as_array()
                .unwrap()
                .iter()
                .any(|hook| hook["name"] == hook_name && hook["enabled"] == false)
        );
        common::invoke_ok(
            "reflect_bind_session",
            json!({ "id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }),
        );
        let restored = (0..100).any(|_| {
            let hooks = common::invoke_ok("reflect_list_hooks", json!({}));
            let found = hooks
                .as_array()
                .unwrap()
                .iter()
                .any(|hook| hook["name"] == hook_name && hook["enabled"] == false);
            if !found {
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            found
        });
        assert!(
            restored,
            "disabled plugin hook must be restored after rebind"
        );
        let ended = (0..100).any(|_| {
            let count = std::fs::read_to_string(&ends)
                .unwrap_or_default()
                .lines()
                .count();
            if count < 2 {
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            count == 2
        });
        assert!(
            ended,
            "previous session end hook must run once before plugin unload"
        );
        common::invoke_ok(
            "reflect_create_task",
            json!({ "list": "hook-probe", "subject": "second", "description": "" }),
        );
        assert_eq!(std::fs::read_to_string(&marker).unwrap().lines().count(), 1);
        common::invoke_ok(
            "reflect_toggle_hook",
            json!({ "name": hook_name, "enabled": true }),
        );
        common::invoke_ok(
            "reflect_create_task",
            json!({ "list": "hook-probe", "subject": "third", "description": "" }),
        );
        assert_eq!(std::fs::read_to_string(&marker).unwrap().lines().count(), 2);
        assert_eq!(std::fs::read_to_string(&starts).unwrap().lines().count(), 2);
        common::invoke_ok("reflect_shutdown", json!({}));
        assert!(common::invoke_ok("reflect_list_plugins", json!({}))[0]["runtime"].is_null());
        common::invoke_ok(
            "reflect_bind_session",
            json!({ "id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }),
        );
        let third_start = (0..100).any(|_| {
            let count = std::fs::read_to_string(&starts)
                .unwrap_or_default()
                .lines()
                .count();
            if count < 3 {
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            count == 3
        });
        assert!(
            third_start,
            "replacement session must start its plugin hook"
        );
        assert_eq!(
            std::fs::read_to_string(&ends).unwrap().lines().count(),
            3,
            "shutdown and rebind must not duplicate session end"
        );
        let saved_preferences = std::fs::read(&preferences).unwrap();
        std::fs::write(&preferences, "invalid json").unwrap();
        common::invoke_err(
            "reflect_uninstall_plugin",
            json!({ "id": "task-probe@localtest", "scope": "user" }),
        );
        assert!(
            common::invoke_ok("reflect_list_plugins", json!({}))
                .as_array()
                .unwrap()
                .is_empty()
        );
        assert!(
            common::invoke_ok("reflect_list_plugin_commands", json!({}))
                .as_array()
                .unwrap()
                .is_empty()
        );
        common::invoke_ok(
            "reflect_create_task",
            json!({ "list": "hook-probe", "subject": "after uninstall", "description": "" }),
        );
        assert_eq!(std::fs::read_to_string(&marker).unwrap().lines().count(), 2);
        std::fs::write(&preferences, saved_preferences).unwrap();
        common::invoke_ok(
            "reflect_install_plugin",
            json!({ "path": fixture.path(), "marketplace": "localtest", "scope": "user" }),
        );
        assert_eq!(
            common::invoke_ok("reflect_list_plugins", json!({}))[0]["runtime"]["command_count"],
            1
        );
        assert!(
            common::invoke_ok("reflect_list_plugin_commands", json!({}))
                .as_array()
                .unwrap()
                .iter()
                .any(|command| command["name"] == "task-probe:hello")
        );
        let saved_preferences = std::fs::read(&preferences).unwrap();
        std::fs::write(&preferences, "invalid json").unwrap();
        common::invoke_ok(
            "reflect_save_config",
            json!({ "toml": "[active]\nprovider = \"openai\"\n[openai]\nmodel = \"test-model\"\n[hooks]\nenabled = [\"test_runner\"]\n[plugins]\nenabled_plugins = []\n" }),
        );
        let status = common::invoke_ok("reflect_agent_status", json!({}));
        assert_eq!(status["model"], "stub/test");
        assert_eq!(common::agent().model_spec(), "openai/test-model");
        let reason = status["degraded_reason"].as_str().unwrap();
        assert!(reason.contains("plugin runtime reload failed"), "{reason}");
        assert!(reason.contains("session rebind failed"), "{reason}");
        std::fs::write(preferences, saved_preferences).unwrap();
        common::invoke_ok(
            "reflect_save_config",
            json!({ "toml": "[active]\nprovider = \"openai\"\n[openai]\nmodel = \"test-model\"\n[hooks]\nenabled = [\"test_runner\"]\n[plugins]\nenabled_plugins = []\n" }),
        );
        let retried = common::invoke_ok("reflect_agent_status", json!({}));
        assert_eq!(retried["model"], "openai/test-model");
        assert!(retried["degraded_reason"].is_null(), "{retried}");
    }
}
