use super::find_exact_heading_line;
use super::*;

#[test]
fn exact_line_match_rejects_prefix_and_extension() {
    let text = "## about\nabout body\n## a\na body\n";
    // key "a" 不能命中 "## about" 的前缀。
    assert_eq!(find_exact_heading_line(text, "## a"), Some((20, 24)));
    assert_eq!(find_exact_heading_line(text, "## about"), Some((0, 8)));
    assert_eq!(find_exact_heading_line(text, "## missing"), None);
}

#[test]
fn sections_can_be_created_updated_and_removed_independently() {
    let workspace = tempfile::tempdir().unwrap();
    let store = MemoryStore;
    store
        .add(
            "project",
            "one",
            "first",
            workspace.path(),
            false,
            true,
            None,
        )
        .unwrap();
    store
        .add(
            "project",
            "two",
            "second",
            workspace.path(),
            false,
            true,
            None,
        )
        .unwrap();
    assert!(
        store
            .add(
                "project",
                "one",
                "replace",
                workspace.path(),
                false,
                true,
                None
            )
            .is_err()
    );
    store
        .add(
            "project",
            "one",
            "updated",
            workspace.path(),
            false,
            false,
            None,
        )
        .unwrap();
    let entries = store.list(workspace.path()).unwrap();
    let one = entries
        .iter()
        .find(|e| e.scope == "project" && e.key == "one")
        .unwrap();
    let two = entries
        .iter()
        .find(|e| e.scope == "project" && e.key == "two")
        .unwrap();
    assert_eq!(one.value, "updated");
    assert_eq!(two.value.trim_end(), "second");
    store
        .remove("project", "one", workspace.path(), false, None)
        .unwrap();
    let entries = store.list(workspace.path()).unwrap();
    assert!(
        !entries
            .iter()
            .any(|e| e.scope == "project" && e.key == "one")
    );
    assert!(
        entries
            .iter()
            .any(|e| e.scope == "project" && e.key == "two" && e.value.trim_end() == "second")
    );
}

#[test]
fn editing_an_unchanged_section_preserves_its_whitespace() {
    let workspace = tempfile::tempdir().unwrap();
    let store = MemoryStore;
    let path = store.path("project", workspace.path()).unwrap();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let original = "## one\ncontent with spaces  \n\n## two\nsecond\n";
    std::fs::write(&path, original).unwrap();
    let entries = store.list(workspace.path()).unwrap();
    let entry = entries
        .iter()
        .find(|e| e.scope == "project" && e.key == "one")
        .unwrap();
    assert_eq!(entry.value, "content with spaces  \n");
    store
        .add(
            "project",
            "one",
            &entry.value,
            workspace.path(),
            false,
            false,
            None,
        )
        .unwrap();
    assert_eq!(std::fs::read_to_string(path).unwrap(), original);
}

#[test]
fn ambiguous_or_unheaded_memory_is_editable_as_a_document() {
    let workspace = tempfile::tempdir().unwrap();
    let store = MemoryStore;
    let path = store.path("project", workspace.path()).unwrap();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    for content in [
        "legacy text",
        "preamble\n## one\nvalue\n",
        "## one\na\n## one\nb\n",
    ] {
        std::fs::write(&path, content).unwrap();
        let entries = store.list(workspace.path()).unwrap();
        let entry = entries.iter().find(|e| e.scope == "project").unwrap();
        assert_eq!(entry.key, "(all)");
        assert_eq!(entry.whole_document, Some(true));
        assert_eq!(entry.value, content);
    }
    assert!(
        store
            .add(
                "project",
                "(all)",
                "new",
                workspace.path(),
                false,
                true,
                None
            )
            .is_err()
    );
    store
        .add(
            "project",
            "(all)",
            "updated document",
            workspace.path(),
            true,
            false,
            None,
        )
        .unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "updated document");
    store
        .remove("project", "(all)", workspace.path(), true, None)
        .unwrap();
    assert!(!path.exists());
}

#[test]
fn malformed_memory_keys_and_unreadable_files_are_rejected() {
    assert!(validate_key("heading\ninjected").is_err());
    assert!(validate_key(" padded ").is_err());
    let dir = tempfile::tempdir().unwrap();
    assert!(read_memory_file(dir.path()).is_err());
}

/// 不变量:GUI 写记忆的路径 == 运行时 pre_loop 注入记忆读的路径。
///
/// 两者都经核心的 `resolve_path` + 同一个活跃 agent 名 —— 此前 GUI 写
/// 死 `agent-memory/reflect/`、运行时读 `agent-memory/<agent>/`，
/// 导致「GUI 里编辑的记忆,agent 根本读不到」。
#[test]
fn memory_path_matches_core_resolution() {
    let ws = PathBuf::from("/tmp/reflect-memory-path-test");
    let home = dirs::home_dir().unwrap_or_default();
    let agent = AgentState::active_agent();
    let store = MemoryStore;
    for (scope, enum_scope) in [
        ("project", MemoryScope::Project),
        ("user", MemoryScope::User),
    ] {
        let expected = resolve_path(enum_scope, &ws, &home, &agent).unwrap();
        let actual = store.path(scope, &ws).unwrap();
        assert_eq!(actual, expected, "{scope} scope 路径与核心不一致");
    }
}

/// 旧版桌面端遗留的 `agent-memory/reflect/` 数据在迁移后不再被读取 ——
/// 迁移把文件搬到了当前活跃 agent 的目录。
#[test]
fn legacy_dir_is_not_the_active_path() {
    let ws = PathBuf::from("/tmp/reflect-memory-legacy-test");
    let home = dirs::home_dir().unwrap_or_default();
    let active = AgentState::active_agent();
    if active == LEGACY_AGENT_DIR {
        // 活跃 agent 就是旧目录名 —— 无需迁移,路径天然一致。
        return;
    }
    let legacy = resolve_path(MemoryScope::Project, &ws, &home, LEGACY_AGENT_DIR).unwrap();
    let current = resolve_path(MemoryScope::Project, &ws, &home, &active).unwrap();
    assert_ne!(legacy, current);
}
