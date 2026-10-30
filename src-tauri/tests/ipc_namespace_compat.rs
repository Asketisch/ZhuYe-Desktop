//! 桌面端与核心共享同一个 `.zhuye` 数据命名空间 —— 就地追加的命令
//! 必须读-改-写,保留文件里已有的内容,不得整份重写把它清掉。
//! 整份写回的命令(如 `reflect_save_config`)按契约替换整个文件,不在此列。
mod common;

#[test]
fn append_commands_preserve_existing_zhuye_data() {
    common::invoke_ok("reflect_list_permission_rules", serde_json::json!({}));
    let home = std::path::PathBuf::from(std::env::var_os("HOME").unwrap());
    let user_rules = home.join(".zhuye/permissions.toml");
    std::fs::create_dir_all(user_rules.parent().unwrap()).unwrap();
    // 预埋一条「别处写进来」的规则:桌面追加后两者必须并存。
    std::fs::write(
        &user_rules,
        b"[[rule]]\ntool = \"other-application\"\naction = \"deny\"\n",
    )
    .unwrap();
    common::invoke_ok(
        "reflect_add_permission_rule",
        serde_json::json!({
            "rule": {"tool": "desktop-probe", "action": "deny"}
        }),
    );
    let own = std::fs::read_to_string(&user_rules).unwrap();
    assert!(own.contains("desktop-probe"));
    assert!(own.contains("other-application"));
    let rules = common::invoke_ok("reflect_list_permission_rules", serde_json::json!({}));
    let rules = rules.as_array().unwrap();
    assert!(rules.iter().any(|r| r["tool"] == "desktop-probe"));
    assert!(rules.iter().any(|r| r["tool"] == "other-application"));

    let workspace = std::env::current_dir().unwrap();
    let memory = workspace.join(".zhuye/agent-memory/default/MEMORY.md");
    std::fs::create_dir_all(memory.parent().unwrap()).unwrap();
    std::fs::write(&memory, b"pre-existing-memory\n").unwrap();
    common::invoke_ok(
        "reflect_add_memory",
        serde_json::json!({
            "scope": "project", "key": "desktop-probe", "value": "desktop-memory"
        }),
    );
    let memory_content = std::fs::read_to_string(&memory).unwrap();
    assert!(memory_content.contains("pre-existing-memory"));
    assert!(memory_content.contains("desktop-memory"));

    // 整份写回是 `reflect_save_config` 的契约:保存后读回同一份内容。
    let own_config = "[active]\nprovider = \"desktop-provider\"\n";
    common::invoke_ok(
        "reflect_save_config",
        serde_json::json!({"toml": own_config}),
    );
    let read = common::invoke_ok("reflect_get_config", serde_json::json!({}));
    assert!(read.as_str().unwrap().contains("desktop-provider"));
}
