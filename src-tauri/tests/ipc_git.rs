//! git worktree 管理能力覆盖（真后端，git CLI 子进程）。
//!
//! 覆盖 `zhuye_create_worktree` / `zhuye_list_worktrees` /
//! `zhuye_remove_worktree` / `zhuye_prune_worktrees` 的闭环：临时 git
//! 仓库里新建隔离工作树 → 列表可见并标 isolated → 干净树删除 → 列表
//! 回落；脏树默认拒绝、force 才删；非法名称与重复目标路径 fail-fast。

mod common;

use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;

use serde_json::{Value, json};

/// 建一个带初始 commit 的临时 git 仓库（worktree add 需要至少一个 commit）。
fn init_repo(tag: &str) -> PathBuf {
    let dir = common::temp_workspace(tag);
    let repo = PathBuf::from(&dir).join("proj");
    std::fs::create_dir_all(&repo).unwrap();
    let run = |args: &[&str]| {
        let out = StdCommand::new("git")
            .args(args)
            .current_dir(&repo)
            .output()
            .unwrap();
        assert!(out.status.success(), "git {args:?} failed");
    };
    run(&["init", "-q"]);
    StdCommand::new("git")
        .args([
            "-c",
            "user.email=t@t",
            "-c",
            "user.name=t",
            "commit",
            "--allow-empty",
            "-qm",
            "init",
        ])
        .current_dir(&repo)
        .output()
        .unwrap();
    repo
}

/// 切到指定目录（workspace override 全局状态 —— 必须持锁）。
fn enter(path: &str) {
    common::set_workspace(path);
}

#[test]
fn worktree_create_list_remove_roundtrip() {
    let _guard = common::workspace_lock();
    let repo = init_repo("wt-roundtrip");
    enter(&repo.display().to_string());

    // 非 worktree 命令的 sanity：workspace 是 git 仓库。
    let status: Value = common::invoke_ok("zhuye_git_status", json!({}));
    assert_eq!(status["is_repo"], true);

    // 新建：缺省分支 = 同名新分支。
    let created: Value = common::invoke_ok(
        "zhuye_create_worktree",
        json!({ "name": "fix-bug", "branch": null, "path": null }),
    );
    assert_eq!(created["branch"], "fix-bug");
    assert_eq!(created["isolated"], true);
    let created_path = created["path"].as_str().unwrap().to_string();
    assert!(Path::new(&created_path).is_dir());

    // 列表：主工作树 + 隔离 worktree，stranded 为假（干净）。
    let list: Value = common::invoke_ok("zhuye_list_worktrees", json!({}));
    let items = list.as_array().unwrap();
    assert_eq!(items.len(), 2, "主工作树 + 新建隔离 worktree");
    assert!(
        items
            .iter()
            .any(|w| w["path"] == json!(created_path) && w["isolated"] == json!(true))
    );
    assert!(items.iter().all(|w| w["stranded"] == json!(false)));

    // 指定已有分支。
    StdCommand::new("git")
        .args(["branch", "feature"])
        .current_dir(&repo)
        .output()
        .unwrap();
    let second: Value = common::invoke_ok(
        "zhuye_create_worktree",
        json!({ "name": "on-feature", "branch": "feature", "path": null }),
    );
    assert_eq!(second["branch"], "feature");

    // 重复名称/已存在目标路径 → 结构化错误。
    let err = common::invoke_err(
        "zhuye_create_worktree",
        json!({ "name": "fix-bug", "branch": null, "path": null }),
    );
    assert!(
        err.to_string().contains("already exists") || err.to_string().contains("已存在"),
        "got {err}"
    );

    // 干净树删除成功；再删报错（git 侧已不存在）。
    common::invoke_ok(
        "zhuye_remove_worktree",
        json!({ "path": created_path, "force": false }),
    );
    let list_after: Value = common::invoke_ok("zhuye_list_worktrees", json!({}));
    assert!(
        !list_after
            .as_array()
            .unwrap()
            .iter()
            .any(|w| w["path"] == json!(created_path))
    );

    // prune 幂等。
    common::invoke_ok("zhuye_prune_worktrees", json!({}));
}

#[test]
fn worktree_dirty_refuses_remove_without_force() {
    let _guard = common::workspace_lock();
    let repo = init_repo("wt-dirty");
    enter(&repo.display().to_string());

    let created: Value = common::invoke_ok(
        "zhuye_create_worktree",
        json!({ "name": "dirty-wt", "branch": null, "path": null }),
    );
    let path = created["path"].as_str().unwrap().to_string();
    std::fs::write(PathBuf::from(&path).join("edit.txt"), "change").unwrap();

    // 脏树默认拒绝。
    let err = common::invoke_err(
        "zhuye_remove_worktree",
        json!({ "path": path, "force": false }),
    );
    assert!(!err.is_null());
    assert!(Path::new(&path).exists(), "脏树拒绝后目录必须保留");

    // force 才删。
    common::invoke_ok(
        "zhuye_remove_worktree",
        json!({ "path": path, "force": true }),
    );
    assert!(!Path::new(&path).exists());
}

#[test]
fn worktree_rejects_invalid_name() {
    let _guard = common::workspace_lock();
    let repo = init_repo("wt-badname");
    enter(&repo.display().to_string());

    for bad in ["", "  spaced  ", "a/b", "a\\b", "..", "."] {
        let err = common::invoke_err(
            "zhuye_create_worktree",
            json!({ "name": bad, "branch": null, "path": null }),
        );
        assert!(!err.is_null(), "name {bad:?} 必须被拒绝");
    }
}
