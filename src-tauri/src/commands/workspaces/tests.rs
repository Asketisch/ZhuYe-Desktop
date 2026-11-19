//! `commands/workspaces.rs` 单元测试 —— 历史持久化 / hidden 语义 /
//! 变体匹配 / 占位清理(v1.x 从内联 `mod tests` 外置,行数预算)。

use super::*;

fn entry(path: &str, last_used: u64) -> WorkspaceInfo {
    WorkspaceInfo {
        path: path.into(),
        label: path.rsplit('/').next().unwrap_or(path).into(),
        last_used,
        session_count: 0,
        hidden: false,
    }
}

#[test]
fn upsert_dedupes_refreshes_and_orders() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("workspaces.json");
    upsert_history(&file, entry("/tmp/a", 10), false).unwrap();
    upsert_history(&file, entry("/tmp/b", 20), false).unwrap();
    // 再次切换 a：去重 + last_used 提到最大。
    upsert_history(&file, entry("/tmp/a", 30), false).unwrap();

    let list = read_history(&file).unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].path, "/tmp/a");
    assert_eq!(list[0].last_used, 30);
    assert_eq!(list[1].path, "/tmp/b");
}

#[test]
fn upsert_preserves_session_count_of_known_path() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("workspaces.json");
    upsert_history(&file, entry("/tmp/a", 10), false).unwrap();
    let mut list = read_history(&file).unwrap();
    list[0].session_count = 7;
    std::fs::write(&file, serde_json::to_string(&list).unwrap()).unwrap();

    upsert_history(&file, entry("/tmp/a", 20), false).unwrap();
    let list = read_history(&file).unwrap();
    assert_eq!(list[0].session_count, 7, "known path keeps its count");
}

/// v1.x 修复:已移除(hidden)的工作区在常规切换(无 unhide)下保持
/// 隐藏 —— incidental 复活是「工作区删不掉」的直接根因;显式
/// `unhide = true` 才恢复显示。
#[test]
fn upsert_keeps_hidden_without_explicit_unhide() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("workspaces.json");
    upsert_history(&file, entry("/tmp/a", 10), false).unwrap();
    // 直接改文件模拟「已移除」状态(与 session_count 保留用例同款手法)。
    let mut list = read_history(&file).unwrap();
    list[0].hidden = true;
    std::fs::write(&file, serde_json::to_string(&list).unwrap()).unwrap();

    // 常规切换(如点击该项目旧会话跟随工作区):保持隐藏。
    upsert_history(&file, entry("/tmp/a", 20), false).unwrap();
    assert!(
        read_history(&file).unwrap()[0].hidden,
        "incidental switch must not revive"
    );

    // 显式恢复:取消隐藏。
    upsert_history(&file, entry("/tmp/a", 30), true).unwrap();
    assert!(
        !read_history(&file).unwrap()[0].hidden,
        "explicit unhide restores"
    );
}

/// v1.x 修复:remove 按规范化路径匹配所有变体(此处用 macOS
/// `/var` → `/private/var` 符号链接构造两个字符串不同的同一目录)。
#[test]
fn hide_workspace_variants_matches_canonical_equivalents() {
    let tmp = tempfile::tempdir().unwrap();
    let proj = tmp.path().join("proj");
    std::fs::create_dir_all(&proj).unwrap();
    let canonical = proj.canonicalize().unwrap();
    assert_ne!(
        canonical.display().to_string(),
        proj.display().to_string(),
        "前置:macOS tempdir 路径应与 canonical 形态不同"
    );

    // 历史里存的是 canonical 变体,移除用的是非 canonical 变体。
    let mut list = vec![entry(&canonical.display().to_string(), 10)];
    assert!(hide_workspace_variants(
        &mut list,
        &proj.display().to_string()
    ));
    assert!(list[0].hidden, "variant of same dir must be hidden");
}

#[test]
fn hide_workspace_variants_no_match_returns_false() {
    let mut list = vec![entry("/tmp/a", 10)];
    assert!(!hide_workspace_variants(&mut list, "/tmp/elsewhere"));
    assert!(!list[0].hidden);
}

#[test]
fn placeholder_workspace_paths_are_recognized() {
    for p in ["", ".", "/", "//", "/.", " . "] {
        assert!(
            is_placeholder_workspace_path(p),
            "{p:?} should be placeholder"
        );
    }
    assert!(!is_placeholder_workspace_path("/tmp/proj"));
    assert!(!is_placeholder_workspace_path("/tmp/proj/"));
}

#[test]
fn upsert_caps_history_length() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("workspaces.json");
    for i in 0..(WORKSPACE_HISTORY_CAP + 5) {
        upsert_history(&file, entry(&format!("/tmp/w{i}"), i as u64), false).unwrap();
    }
    assert_eq!(read_history(&file).unwrap().len(), WORKSPACE_HISTORY_CAP);
}

#[test]
fn corrupt_history_is_reported_and_not_overwritten() {
    let dir = tempfile::tempdir().unwrap();
    assert!(
        read_history(&dir.path().join("none.json"))
            .unwrap()
            .is_empty()
    );
    let file = dir.path().join("workspaces.json");
    std::fs::write(&file, "not json").unwrap();
    assert!(read_history(&file).is_err());
    assert!(upsert_history(&file, entry("/tmp/a", 10), false).is_err());
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "not json");
}

#[cfg(unix)]
#[test]
fn history_update_preserves_symlink_and_respects_read_only_file() {
    use std::os::unix::fs::{PermissionsExt, symlink};

    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("history.json");
    let link = dir.path().join("workspaces.json");
    std::fs::write(&target, "[]").unwrap();
    symlink(&target, &link).unwrap();
    upsert_history(&link, entry("/tmp/a", 10), false).unwrap();
    assert!(
        std::fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert_eq!(read_history(&target).unwrap()[0].path, "/tmp/a");
    std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o444)).unwrap();
    assert!(upsert_history(&link, entry("/tmp/b", 20), false).is_err());
    assert_eq!(read_history(&target).unwrap().len(), 1);
}
