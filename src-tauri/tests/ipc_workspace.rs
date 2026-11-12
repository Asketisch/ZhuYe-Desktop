//! 能力覆盖层 · 工作区域 —— 真实命令体 over 真实 IPC 通路。
//!
//! 覆盖:工作区历史 / 文件树 / 读写文件 / 全文搜索 / 终端 shell /
//! 媒体工作室 / 沙箱状态 / Git 全流程 / 会话 Markdown 导出。
//!
//! 涉及**全局工作区**的用例(文件 / git / shell)共用一把互斥锁并串行执行 ——
//! 否则并行跑会互相改工作区。Git 流程在**临时仓库**里跑,绝不动真实仓库。

mod common;

use common::{
    current_workspace, invoke, invoke_err, invoke_ok, set_workspace, temp_workspace, workspace_lock,
};
use serde_json::json;

// ============================================================================
// 工作区历史
// ============================================================================

#[test]
fn workspace_history_round_trips() {
    let _guard = workspace_lock();
    let before = invoke_ok("reflect_list_workspaces", json!({}));
    assert!(before.is_array(), "工作区列表应为数组: {before}");

    let probe = temp_workspace("ws-history");
    set_workspace(&probe);
    // 历史里应出现刚设置的工作区。
    let after = invoke_ok("reflect_list_workspaces", json!({}));
    let hit = after
        .as_array()
        .expect("工作区列表应为数组")
        .iter()
        .find(|w| w["path"].as_str() == Some(probe.as_str()))
        .expect("新工作区未进入历史");
    assert!(hit["label"].is_string(), "工作区缺少 label: {hit}");
}

#[test]
fn switching_workspace_rejects_input_bound_to_the_previous_directory() {
    let _guard = workspace_lock();
    let first = temp_workspace("session-workspace-a");
    let second = temp_workspace("session-workspace-b");
    set_workspace(&first);
    let id = invoke_ok("reflect_create_session", json!({}));
    invoke_ok("reflect_bind_session", json!({ "id": id }));
    set_workspace(&second);

    let error = invoke_err(
        "reflect_submit",
        json!({ "submission": {
            "id": "stale-workspace",
            "workspace": second,
            "op": { "type": "user_input", "items": [{ "type": "text", "text": "hello" }] }
        }}),
    );
    assert!(error.to_string().contains("workspace changed"), "{error}");
    let error = invoke_err(
        "reflect_steer",
        json!({ "items": [{ "type": "text", "text": "hello" }] }),
    );
    assert!(error.to_string().contains("workspace changed"), "{error}");
}

#[test]
fn opening_a_session_requires_its_recorded_workspace() {
    let _guard = workspace_lock();
    let first = temp_workspace("recorded-workspace-a");
    let second = temp_workspace("recorded-workspace-b");
    set_workspace(&second);
    let id = invoke_ok("reflect_create_session", json!({}));
    let base = reflect_rollout::path::default_base();
    std::fs::create_dir_all(&base).unwrap();
    let record = json!({
        "type": "session_meta", "session_id": id, "model": "test",
        "started_at": "2026-01-01T00:00:00Z", "workspace": first,
    });
    std::fs::write(
        base.join(format!("{}.jsonl", id.as_str().unwrap())),
        format!("{record}\n"),
    )
    .unwrap();
    let error = invoke_err("reflect_bind_session", json!({ "id": id }));
    assert!(
        error.to_string().contains("session belongs to workspace"),
        "{error}"
    );
    set_workspace(&first);
    invoke_ok("reflect_bind_session", json!({ "id": id }));
}

#[test]
fn native_pickers_report_unavailable_without_desktop_runtime() {
    // mock runtime 下没有应用句柄 —— 原生对话框必须**报结构化错误**,
    // 而不是 panic 或挂死。
    let e = invoke_err("reflect_pick_workspace_folder", json!({}));
    assert!(!e.is_null(), "错误响应不应为 null");
    let e = invoke_err("reflect_pick_file", json!({ "extensions": ["toml"] }));
    assert!(!e.is_null(), "错误响应不应为 null");
}

// ============================================================================
// 文件树与读写
// ============================================================================

#[test]
fn file_tree_read_write_round_trip() {
    let _guard = workspace_lock();
    let ws = temp_workspace("files");
    set_workspace(&ws);

    // 目录列表
    let listing = invoke_ok("reflect_list_dir", json!({ "path": ws, "maxDepth": 2 }));
    let entries = listing["entries"]
        .as_array()
        .unwrap_or_else(|| panic!("目录列表缺少 entries: {listing}"));
    assert!(
        entries.iter().any(|e| e["name"] == "probe.txt"),
        "目录列表里没有探针文件: {listing}"
    );

    // 写文件
    let target = format!("{ws}/written.txt");
    invoke_ok(
        "reflect_write_file",
        json!({ "path": target, "content": "hello capability layer\n" }),
    );

    // 读回
    let read = invoke_ok("reflect_read_file", json!({ "path": target }));
    assert_eq!(
        read["content"], "hello capability layer\n",
        "读回内容不符: {read}"
    );
    assert_eq!(read["binary"], false, "文本文件不应标为 binary: {read}");
    assert!(
        read["size"].as_u64().unwrap_or(0) > 0,
        "文件大小应为正: {read}"
    );
}

#[test]
fn reading_missing_file_returns_structured_error() {
    let _guard = workspace_lock();
    let ws = temp_workspace("files-missing");
    set_workspace(&ws);
    let e = invoke_err("reflect_read_file", json!({ "path": "no-such-file.txt" }));
    assert!(!e.is_null(), "错误响应不应为 null");
}

#[test]
fn path_escape_outside_workspace_is_rejected() {
    let _guard = workspace_lock();
    let ws = temp_workspace("files-escape");
    set_workspace(&ws);
    // 越界路径必须被拒 —— 这是能力覆盖层要盯住的安全不变量。
    let e = invoke_err(
        "reflect_read_file",
        json!({ "path": "../../../etc/passwd" }),
    );
    assert!(!e.is_null(), "越界读取必须返回错误");
}

/// 目录列表与搜索都会暴露工作区外的文件名 / 行内容，沙盒规则必须与读写一致。
#[test]
fn listing_and_searching_outside_the_workspace_is_rejected() {
    let _guard = workspace_lock();
    let root = std::env::temp_dir().join(format!(
        "reflect-desktop-capability-{}-escape-roots",
        std::process::id()
    ));
    std::fs::create_dir_all(&root).expect("create escape root");
    let ws = root.join("workspace");
    let outside = root.join("outside");
    std::fs::create_dir_all(&ws).expect("create workspace");
    std::fs::create_dir_all(&outside).expect("create outside dir");
    std::fs::write(outside.join("secret.txt"), "do not leak\n").expect("write outside file");
    set_workspace(&ws.display().to_string());

    let listed = invoke_err(
        "reflect_list_dir",
        json!({ "path": outside.display().to_string(), "maxDepth": 1 }),
    );
    assert!(
        listed.to_string().contains("escapes workspace"),
        "越界目录列表必须被拒: {listed}"
    );
    let searched = invoke_err(
        "reflect_search_files",
        json!({ "query": "leak", "path": outside.display().to_string() }),
    );
    assert!(
        searched.to_string().contains("escapes workspace"),
        "越界搜索必须被拒: {searched}"
    );
    let traversed = invoke_err("reflect_list_dir", json!({ "path": "a/../b" }));
    assert!(
        traversed.to_string().contains("must not contain '..'"),
        "带 .. 的列表路径必须被拒: {traversed}"
    );
}

#[test]
fn file_search_returns_ranked_hits() {
    let _guard = workspace_lock();
    let ws = temp_workspace("search");
    set_workspace(&ws);
    let v = invoke_ok(
        "reflect_search_files",
        json!({ "query": "capability", "path": ws, "maxResults": 10 }),
    );
    assert!(v.is_object(), "搜索结果应为对象: {v}");
    let exact = invoke_ok(
        "reflect_search_files",
        json!({ "query": "capability layer probe", "path": ws, "maxResults": 1 }),
    );
    assert_eq!(exact["hits"].as_array().unwrap().len(), 1);
    assert_eq!(exact["truncated"], false);
    let zero = invoke_ok(
        "reflect_search_files",
        json!({ "query": "capability layer probe", "path": ws, "maxResults": 0 }),
    );
    assert_eq!(zero["truncated"], true);
    let bm25 = invoke_ok(
        "reflect_search_files",
        json!({ "query": "capability", "path": ws, "maxResults": 10, "rank": "bm25" }),
    );
    assert!(bm25.is_object(), "BM25 搜索结果应为对象: {bm25}");
}

// ============================================================================
// 终端
// ============================================================================

#[test]
fn shell_session_runs_and_registers() {
    let _guard = workspace_lock();
    let ws = temp_workspace("shell");
    set_workspace(&ws);

    let session = invoke_ok(
        "reflect_run_shell",
        json!({ "cmd": "echo capability-probe" }),
    );
    let id = session["id"]
        .as_str()
        .expect("shell 会话缺少 id")
        .to_string();
    assert_eq!(
        session["command"], "echo capability-probe",
        "命令回显不符: {session}"
    );

    let active = invoke_ok("reflect_list_shell_sessions", json!({}));
    assert!(
        active
            .as_array()
            .expect("shell 会话列表应为数组")
            .contains(&json!(id)),
        "shell 会话未注册: {active}"
    );

    // 幂等 kill。
    invoke_ok("reflect_kill_shell", json!({ "sessionId": id.as_str() }));
    invoke_ok("reflect_kill_shell", json!({ "sessionId": id }));
}

// ============================================================================
// 媒体工作室
// ============================================================================

#[test]
fn media_capabilities_and_listing() {
    let caps = invoke_ok("reflect_media_capabilities", json!({}));
    assert!(caps.is_object(), "媒体能力应为对象: {caps}");

    let dir = temp_workspace("media");
    let list = invoke_ok("reflect_list_media", json!({ "dir": dir }));
    assert!(list.is_array(), "媒体列表应为数组: {list}");
}

#[test]
fn image_process_converts_real_png() {
    let dir = temp_workspace("image");
    let input = format!("{dir}/in.png");
    let output = format!("{dir}/out.jpg");
    // 用 image crate 造一张真 PNG —— 媒体后端要真解码,不能糊弄。
    let img = image::RgbaImage::from_pixel(4, 4, image::Rgba([10, 20, 30, 255]));
    img.save(&input).expect("write test png");

    let result = invoke_ok(
        "reflect_image_process",
        json!({ "spec": { "inputPath": input, "outputPath": output, "format": "jpeg" } }),
    );
    assert!(result.is_object(), "图片处理结果应为对象: {result}");
    assert!(
        std::path::Path::new(&output).exists(),
        "输出文件未生成: {result}"
    );
}

#[test]
fn image_base64_is_readable() {
    let dir = temp_workspace("image-b64");
    let input = format!("{dir}/in.png");
    let img = image::RgbaImage::from_pixel(2, 2, image::Rgba([1, 2, 3, 255]));
    img.save(&input).expect("write test png");

    let v = invoke_ok("reflect_read_image_base64", json!({ "path": input }));
    assert!(v.is_object(), "base64 结果应为对象: {v}");
    let data = v["base64"].as_str().unwrap_or_default();
    assert!(!data.is_empty(), "base64 数据为空: {v}");
    assert_eq!(v["mime_type"], "image/png", "mime 类型不符: {v}");
}

#[test]
fn search_and_media_reflect_workspace_changes() {
    let _guard = workspace_lock();
    let ws = temp_workspace("search-media-change");
    set_workspace(&ws);
    let note = std::path::Path::new(&ws).join("runtime-note.md");
    let png_path = std::path::Path::new(&ws).join("runtime-asset.png");
    let jpg_path = std::path::Path::new(&ws).join("runtime-asset.jpg");
    std::fs::write(&note, "runtime-change-marker\n").unwrap();
    image::RgbaImage::from_pixel(3, 3, image::Rgba([7, 8, 9, 255]))
        .save(&png_path)
        .unwrap();

    let hits = invoke_ok(
        "reflect_search_files",
        json!({ "query": "runtime-change-marker", "path": ws, "maxResults": 10 }),
    );
    assert!(
        hits["hits"]
            .as_array()
            .unwrap()
            .iter()
            .any(|hit| hit["path"]
                .as_str()
                .unwrap_or_default()
                .contains("runtime-note.md")),
        "new file did not enter search: {hits}"
    );
    let media = invoke_ok("reflect_list_media", json!({ "dir": ws }));
    assert!(
        media.as_array().unwrap().iter().any(|asset| asset["path"]
            .as_str()
            .unwrap_or_default()
            .contains("runtime-asset.png")),
        "new image did not enter media list: {media}"
    );

    invoke_ok(
        "reflect_image_process",
        json!({ "spec": { "inputPath": png_path, "outputPath": jpg_path, "format": "jpeg" } }),
    );
    let processed = invoke_ok("reflect_list_media", json!({ "dir": ws }));
    assert!(
        processed
            .as_array()
            .unwrap()
            .iter()
            .any(|asset| asset["path"]
                .as_str()
                .unwrap_or_default()
                .contains("runtime-asset.jpg")),
        "processed image did not enter media list: {processed}"
    );

    std::fs::remove_file(&note).unwrap();
    std::fs::remove_file(&jpg_path).unwrap();
    let after_search = invoke_ok(
        "reflect_search_files",
        json!({ "query": "runtime-change-marker", "path": ws, "maxResults": 10 }),
    );
    assert!(
        after_search["hits"].as_array().unwrap().is_empty(),
        "deleted file remained in search: {after_search}"
    );
    let after_media = invoke_ok("reflect_list_media", json!({ "dir": ws }));
    assert!(
        !after_media
            .as_array()
            .unwrap()
            .iter()
            .any(|asset| asset["path"]
                .as_str()
                .unwrap_or_default()
                .contains("runtime-asset.jpg")),
        "deleted processed image remained in media list: {after_media}"
    );
}

// ============================================================================
// Dock 徽标
// ============================================================================

#[test]
fn dock_badge_command_is_callable_without_desktop_runtime() {
    // mock runtime 下没有应用句柄 → 命令**静默 no-op**,不 panic。
    invoke_ok("reflect_set_dock_badge", json!({ "label": "1" }));
    invoke_ok("reflect_set_dock_badge", json!({ "label": null }));
}

// ============================================================================
// 沙箱
// ============================================================================

#[test]
fn sandbox_status_is_readable() {
    let v = invoke_ok("reflect_sandbox_status", json!({}));
    assert!(v.is_object(), "沙箱状态应为对象: {v}");
}

// ============================================================================
// Git —— 在临时仓库里跑,绝不动真实仓库
// ============================================================================

#[test]
fn git_full_flow_in_temp_repo() {
    let _guard = workspace_lock();
    let ws = temp_workspace("git");
    // 初始化一个真 git 仓库(需要 git 可用)。
    let init = std::process::Command::new("git")
        .args(["init", "-q"])
        .current_dir(&ws)
        .output();
    if init.is_err() || !init.as_ref().unwrap().status.success() {
        eprintln!("跳过:本机无 git 或 git init 失败");
        return;
    }
    for args in [
        vec!["config", "user.email", "probe@example.invalid"],
        vec!["config", "user.name", "Capability Probe"],
    ] {
        let _ = std::process::Command::new("git")
            .args(&args)
            .current_dir(&ws)
            .output();
    }
    let add_baseline = std::process::Command::new("git")
        .args(["add", "probe.txt"])
        .current_dir(&ws)
        .output()
        .expect("stage baseline file");
    assert!(
        add_baseline.status.success(),
        "baseline add failed: {add_baseline:?}"
    );
    let baseline = std::process::Command::new("git")
        .args(["commit", "-qm", "baseline"])
        .current_dir(&ws)
        .output()
        .expect("create baseline commit");
    assert!(
        baseline.status.success(),
        "baseline commit failed: {baseline:?}"
    );
    std::fs::write(
        std::path::Path::new(&ws).join("probe.txt"),
        "modified capability probe\n",
    )
    .unwrap();
    set_workspace(&ws);

    // status —— 有一个未跟踪文件
    let status = invoke_ok("reflect_git_status", json!({}));
    assert!(status.is_object(), "git status 应为对象: {status}");

    // stage
    invoke_ok("reflect_git_stage", json!({ "paths": ["probe.txt"] }));
    let staged = invoke_ok("reflect_git_status", json!({}));
    assert!(
        staged.to_string().contains("probe.txt"),
        "暂存后 status 未提及 probe.txt: {staged}"
    );

    // diff(staged)
    let diff = invoke_ok("reflect_git_diff", json!({ "staged": true }));
    assert!(
        diff.as_str()
            .unwrap_or_default()
            .contains("+modified capability probe"),
        "暂存差异未包含真实文件内容: {diff}"
    );

    // unstage
    invoke_ok("reflect_git_unstage", json!({ "paths": ["probe.txt"] }));
    let unstaged = invoke_ok("reflect_git_diff", json!({ "staged": false }));
    assert!(
        unstaged
            .as_str()
            .unwrap_or_default()
            .contains("+modified capability probe"),
        "撤销暂存后未回到工作区差异: {unstaged}"
    );
    let staged_after_unstage = invoke_ok("reflect_git_diff", json!({ "staged": true }));
    assert_eq!(
        staged_after_unstage.as_str().unwrap_or_default().trim(),
        "",
        "撤销暂存后暂存差异应为空: {staged_after_unstage}"
    );

    // 重新暂存再提交 —— `git commit` 没有暂存内容时会以非零码退出
    // ("nothing to commit"),那不是后端 bug,是 git 语义。
    invoke_ok("reflect_git_stage", json!({ "paths": ["probe.txt"] }));

    // commit
    let commit = invoke_ok(
        "reflect_git_commit",
        json!({ "message": "capability probe" }),
    );
    assert!(commit.is_string(), "git commit 应为字符串: {commit}");

    // log
    let log = invoke_ok("reflect_git_log", json!({ "limit": 5 }));
    assert!(log.is_array(), "git log 应为数组: {log}");
    assert!(
        log.as_array()
            .expect("git log 应为数组")
            .iter()
            .any(|e| e["subject"]
                .as_str()
                .unwrap_or_default()
                .contains("capability probe")),
        "提交未出现在 log 里: {log}"
    );
    let clean = invoke_ok("reflect_git_status", json!({}));
    assert!(
        !clean.to_string().contains("probe.txt"),
        "提交后工作区仍有 probe.txt 变更: {clean}"
    );
    let empty_commit = invoke(
        "reflect_git_commit",
        json!({ "message": "nothing to commit" }),
    );
    assert!(
        empty_commit.is_err(),
        "无变更提交应以结构化错误返回: {empty_commit:?}"
    );

    // worktrees
    assert!(invoke_ok("reflect_list_worktrees", json!({})).is_array());
}

// ============================================================================
// 会话导出
// ============================================================================

#[test]
fn export_session_markdown_reports_missing_session() {
    // 不存在的会话 → 结构化错误或空结果,不得 panic。
    let out = invoke(
        "reflect_export_session_markdown",
        json!({ "id": "00000000-0000-0000-0000-000000000000" }),
    );
    match out {
        Ok(v) => assert!(v.is_object(), "导出结果应为对象: {v}"),
        Err(e) => assert!(!e.is_null(), "错误响应不应为 null"),
    }
}

// ============================================================================
// 会话导出 / 回放
// ============================================================================

#[test]
fn session_export_and_replay_are_reachable() {
    let _guard = workspace_lock();
    let id = invoke_ok("reflect_create_session", json!({}));
    let id = id.as_str().expect("session id 应为字符串").to_string();

    // 回放一个不存在的会话 → 空记录数组(不报错)。
    let replay = invoke_ok("reflect_replay_session", json!({ "id": id }));
    assert!(replay.is_array(), "回放结果应为数组: {replay}");

    // 导出不存在的会话 → 结构化错误或空结果,不得 panic。
    let exported = common::invoke("reflect_export_session", json!({ "id": id }));
    match exported {
        Ok(v) => assert!(v.is_string() || v.is_object(), "导出结果形态异常: {v}"),
        Err(e) => assert!(!e.is_null(), "错误响应不应为 null"),
    }
}

#[cfg(unix)]
#[test]
fn session_exports_replace_links_without_changing_their_targets() {
    let id = invoke_ok("reflect_create_session", json!({}));
    let session_id = id.as_str().unwrap();
    let base = reflect_rollout::path::default_base();
    std::fs::create_dir_all(&base).unwrap();
    let record = json!({"type": "session_meta", "session_id": id, "model": "test", "started_at": "2026-01-01T00:00:00Z", "workspace": null});
    std::fs::write(
        base.join(format!("{session_id}.jsonl")),
        format!("{record}\n"),
    )
    .unwrap();
    let export_dir = dirs::home_dir().unwrap().join(".zhuye/exports");
    std::fs::create_dir_all(&export_dir).unwrap();
    let external = tempfile::tempdir().unwrap();
    let target = external.path().join("original");
    std::fs::write(&target, "unchanged").unwrap();
    for (extension, command) in [
        ("json", "reflect_export_session"),
        ("md", "reflect_export_session_markdown"),
    ] {
        let path = export_dir.join(format!("{session_id}.{extension}"));
        std::os::unix::fs::symlink(&target, &path).unwrap();
        invoke_ok(command, json!({"id": id}));
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "unchanged");
        assert!(
            !std::fs::symlink_metadata(path)
                .unwrap()
                .file_type()
                .is_symlink()
        );
    }
}

#[test]
fn deleted_bound_session_rejects_further_submissions() {
    let _workspace = workspace_lock();
    let _guard = common::state_lock();
    let id = invoke_ok("reflect_create_session", json!({}));
    invoke_ok("reflect_bind_session", json!({"id": id}));
    invoke_ok("reflect_delete_session", json!({"id": id}));
    invoke_err(
        "reflect_submit",
        json!({"submission": {"id": "after-delete", "op": {"type": "user_input", "items": [{"type": "text", "text": "after deletion"}]}}}),
    );
    let records = invoke_ok("reflect_replay_session", json!({"id": id}));
    assert_eq!(records, json!([]));
}

#[test]
fn archived_bound_session_rejects_further_submissions() {
    let _workspace = workspace_lock();
    let _guard = common::state_lock();
    let id = invoke_ok("reflect_create_session", json!({}));
    invoke_ok("reflect_bind_session", json!({"id": id}));
    invoke_ok("reflect_archive_session", json!({"id": id}));
    invoke_err(
        "reflect_submit",
        json!({"submission": {"id": "after-archive", "op": {"type": "user_input", "items": [{"type": "text", "text": "after archive"}]}}}),
    );
    assert_eq!(
        invoke_ok("reflect_replay_session", json!({"id": id})),
        json!([])
    );
}

#[test]
fn failed_archive_restores_the_active_session() {
    let _workspace = workspace_lock();
    let _guard = common::state_lock();
    let id = invoke_ok("reflect_create_session", json!({}));
    let name = format!("{}.name", id.as_str().unwrap());
    let base_names = reflect_rollout::path::default_base().join("_names");
    let archive_names = dirs::home_dir()
        .unwrap()
        .join(".zhuye/sessions-archive/_names");
    std::fs::create_dir_all(&base_names).unwrap();
    std::fs::create_dir_all(&archive_names).unwrap();
    std::fs::write(base_names.join(&name), "active").unwrap();
    std::fs::write(archive_names.join(&name), "existing").unwrap();
    invoke_ok("reflect_bind_session", json!({"id": id}));
    invoke_err("reflect_archive_session", json!({"id": id}));
    assert_eq!(
        std::fs::read_to_string(base_names.join(&name)).unwrap(),
        "active"
    );
    assert_eq!(
        std::fs::read_to_string(archive_names.join(&name)).unwrap(),
        "existing"
    );
    invoke_ok(
        "reflect_submit",
        json!({"submission": {"id": "after-failed-archive", "op": {"type": "user_input", "items": [{"type": "text", "text": "still active"}]}}}),
    );
}

#[test]
fn unarchive_rejects_the_active_session_until_it_is_switched() {
    let _workspace = workspace_lock();
    let _guard = common::state_lock();
    let id = invoke_ok("reflect_create_session", json!({}));
    let name = format!("{}.name", id.as_str().unwrap());
    let archive = dirs::home_dir()
        .unwrap()
        .join(".zhuye/sessions-archive/_names");
    let active = reflect_rollout::path::default_base().join("_names");
    std::fs::create_dir_all(&archive).unwrap();
    std::fs::write(archive.join(&name), "archived title").unwrap();
    invoke_ok("reflect_bind_session", json!({"id": id}));
    let error = invoke_err("reflect_unarchive_session", json!({"id": id}));
    assert!(error.to_string().contains("switch sessions first"));
    assert_eq!(
        std::fs::read_to_string(archive.join(&name)).unwrap(),
        "archived title"
    );
    assert!(!active.join(&name).exists());
    let other = invoke_ok("reflect_create_session", json!({}));
    invoke_ok("reflect_bind_session", json!({"id": other}));
    invoke_ok("reflect_unarchive_session", json!({"id": id}));
    assert_eq!(
        std::fs::read_to_string(active.join(&name)).unwrap(),
        "archived title"
    );
}

#[test]
fn forked_history_remains_available_after_parent_deletion() {
    let _workspace = workspace_lock();
    let _guard = common::state_lock();
    let id = invoke_ok("reflect_create_session", json!({}));
    let base = reflect_rollout::path::default_base();
    std::fs::create_dir_all(&base).unwrap();
    let record = json!({"type": "session_meta", "session_id": id, "model": "test", "started_at": "2026-01-01T00:00:00Z", "workspace": null});
    std::fs::write(
        base.join(format!("{}.jsonl", id.as_str().unwrap())),
        format!("{record}\n"),
    )
    .unwrap();
    let child = invoke_ok(
        "reflect_fork_session",
        json!({"id": id, "branch": "child", "upToTurnId": null}),
    );
    let before = invoke_ok("reflect_replay_session", json!({"id": child}));
    assert!(!before.as_array().unwrap().is_empty());
    invoke_ok("reflect_delete_session", json!({"id": id}));
    assert_eq!(
        invoke_ok("reflect_replay_session", json!({"id": child})),
        before
    );
    assert_eq!(
        invoke_ok("reflect_replay_session", json!({"id": id})),
        json!([])
    );
}

#[test]
fn deleting_a_previous_session_does_not_cancel_the_current_session() {
    let _workspace = workspace_lock();
    let _guard = common::state_lock();
    let old = invoke_ok("reflect_create_session", json!({}));
    let current = invoke_ok("reflect_create_session", json!({}));
    invoke_ok("reflect_bind_session", json!({"id": old}));
    invoke_ok("reflect_bind_session", json!({"id": current}));
    invoke_ok("reflect_delete_session", json!({"id": old}));
    invoke_ok(
        "reflect_submit",
        json!({"submission": {"id": "still-active", "op": {"type": "user_input", "items": [{"type": "text", "text": "current session"}]}}}),
    );
}

// ============================================================================
// 模型切换
// ============================================================================

#[test]
fn set_model_rejects_unknown_provider() {
    let _guard = common::state_lock();
    // 未知 provider → 结构化错误(错误信息里带期望值)。
    let e = invoke_err(
        "reflect_set_model",
        json!({ "provider": "not-a-provider", "model": "x" }),
    );
    let msg = e.to_string();
    assert!(
        msg.contains("anthropic") && msg.contains("ollama"),
        "错误信息应列出受支持的 provider: {msg}"
    );
}

// ============================================================================
// 网络类命令 —— 只断言「有结构化结果」,不要求联网成功
// ============================================================================

#[test]
fn network_dependent_commands_return_structured_results() {
    // 这些命令依赖外网(更新检查 / PR 列表 / provider 探测)。
    // CI 无网时它们应返回**结构化错误**,而不是 panic 或挂死 ——
    // 这正是发布门禁要盯的:错误路径也要健壮。
    for (cmd, body) in [
        ("reflect_check_update", json!({})),
        ("reflect_gh_pr_list", json!({ "limit": 1 })),
    ] {
        match invoke(cmd, body) {
            Ok(v) => assert!(!v.is_null(), "{cmd} 返回 null"),
            Err(e) => assert!(!e.is_null(), "{cmd} 错误响应不应为 null"),
        }
    }
}

#[test]
fn workspace_is_restored_after_workspace_scoped_tests() {
    // 兜底:确认工作区仍可读(前面的用例切换过工作区)。
    let ws = current_workspace();
    assert!(!ws.is_empty(), "当前工作区不应为空");
}
