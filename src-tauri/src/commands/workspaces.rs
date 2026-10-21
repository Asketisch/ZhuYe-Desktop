//! Workspace 命令。
//!
//! - 列表持久化在 `~/.reflect/workspaces.json`（`[WorkspaceInfo]` 数组）；
//!   `reflect_set_workspace` 每次切换 upsert 该文件，作为「最近项目」历史。
//! - `reflect_pick_workspace_folder` 走 `tauri-plugin-dialog` 的 Rust 侧
//!   API 弹原生目录选择框 —— 不经 JS IPC，无需 dialog capability。
//! - `reflect_reveal_path` 在系统文件管理器中定位路径（macOS Finder /
//!   Windows 资源管理器 / Linux xdg-open）。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_dialog::DialogExt;

use crate::commands::error::{CommandError, CommandResult};
use crate::state::MinimalAgent;

/// 「最近项目」历史的最大保留条数。
const WORKSPACE_HISTORY_CAP: usize = 20;

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceInfo {
    pub path: String,
    pub label: String,
    pub last_used: u64,
    pub session_count: usize,
}

fn workspaces_file() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".reflect/workspaces.json"))
}

/// 读 `~/.reflect/workspaces.json`；不存在或损坏 → 空表（损坏时保留
/// 原文件不动，由下一次 set 的写入覆盖修复）。
fn read_history(path: &Path) -> Vec<WorkspaceInfo> {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

/// upsert 一条 workspace 记录（同 path 去重、last_used 刷新、按最近使用
/// 倒序、截断到 [`WORKSPACE_HISTORY_CAP`]）并写回。
fn upsert_history(path: &Path, entry: WorkspaceInfo) -> CommandResult<()> {
    let mut list = read_history(path);
    let prev_count = list
        .iter()
        .find(|w| w.path == entry.path)
        .map(|w| w.session_count)
        .unwrap_or(0);
    let mut entry = entry;
    entry.session_count = prev_count;
    list.retain(|w| w.path != entry.path);
    list.insert(0, entry);
    list.sort_by_key(|a| std::cmp::Reverse(a.last_used));
    list.truncate(WORKSPACE_HISTORY_CAP);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(&list).map_err(|e| CommandError {
        msg: format!("serialize workspaces.json: {e}"),
    })?;
    std::fs::write(path, json)?;
    Ok(())
}

/// 列出已知 workspace（从 `~/.reflect/workspaces.json` 读取）。
#[tauri::command]
pub async fn reflect_list_workspaces() -> CommandResult<Vec<WorkspaceInfo>> {
    let path = workspaces_file().ok_or_else(|| CommandError {
        msg: "no HOME dir".into(),
    })?;
    let list = read_history(&path);
    if list.is_empty() {
        // 无历史时仅返回当前 workspace，保证视图有可切换的落点。
        let cur = dirs::home_dir()
            .map(|h| h.join(".").display().to_string())
            .unwrap_or_else(|| ".".to_string());
        return Ok(vec![WorkspaceInfo {
            path: cur,
            label: "default".to_string(),
            last_used: 0,
            session_count: 0,
        }]);
    }
    Ok(list)
}

#[tauri::command]
pub async fn reflect_set_workspace(
    agent: State<'_, MinimalAgent>,
    path: String,
) -> CommandResult<()> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(CommandError {
            msg: format!("workspace path does not exist: {path}"),
        });
    }
    if !p.is_dir() {
        return Err(CommandError {
            msg: format!("workspace path is not a directory: {path}"),
        });
    }
    // 切换即记录「最近项目」历史（label = 目录名）。
    if let Some(hist) = workspaces_file() {
        let label = p
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.clone());
        let entry = WorkspaceInfo {
            path: path.clone(),
            label,
            last_used: unix_now(),
            session_count: 0,
        };
        if let Err(e) = upsert_history(&hist, entry) {
            // 历史写失败不阻断切换 —— workspace 本身已生效。
            tracing::warn!("[reflect-gui] persist workspace history failed: {}", e.msg);
        }
    }
    agent.set_workspace(p);
    Ok(())
}

#[tauri::command]
pub async fn reflect_current_workspace(agent: State<'_, MinimalAgent>) -> CommandResult<String> {
    Ok(agent.workspace().display().to_string())
}

/// 弹出原生目录选择框，返回用户选择的项目目录；取消 → `None`。
///
/// 对话框由插件分发到主线程；这里用 oneshot 把回调折叠回 async 返回值，
/// 不阻塞 tokio worker。
#[tauri::command]
pub async fn reflect_pick_workspace_folder(app: tauri::AppHandle) -> CommandResult<Option<String>> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |folder| {
        let picked = folder
            .and_then(|f| f.into_path().ok())
            .map(|p| p.display().to_string());
        let _ = tx.send(picked);
    });
    let picked = rx.await.map_err(|e| CommandError {
        msg: format!("folder picker closed unexpectedly: {e}"),
    })?;
    Ok(picked)
}

/// 弹出原生文件选择框（discussion / pipeline 的 TOML 配置入口）；取消 → `None`。
///
/// `extensions` 为扩展名白名单（不含点，如 `["toml"]`）；空列表 = 不过滤。
#[tauri::command]
pub async fn reflect_pick_file(
    app: tauri::AppHandle,
    extensions: Option<Vec<String>>,
) -> CommandResult<Option<String>> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut builder = app.dialog().file();
    if let Some(exts) = extensions.filter(|e| !e.is_empty()) {
        let str_exts: Vec<&str> = exts.iter().map(String::as_str).collect();
        builder = builder.add_filter("Config", &str_exts);
    }
    builder.pick_file(move |file| {
        let picked = file
            .and_then(|f| f.into_path().ok())
            .map(|p| p.display().to_string());
        let _ = tx.send(picked);
    });
    let picked = rx.await.map_err(|e| CommandError {
        msg: format!("file picker closed unexpectedly: {e}"),
    })?;
    Ok(picked)
}

/// 在系统文件管理器中定位并选中 `path`（Finder 显示 / 资源管理器选中 /
/// xdg-open 打开所在目录）。
#[tauri::command]
pub async fn reflect_reveal_path(path: String) -> CommandResult<()> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(CommandError {
            msg: format!("path does not exist: {path}"),
        });
    }

    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg("-R").arg(&p);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("explorer");
        c.arg(format!("/select,{}", p.display()));
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        // xdg-open 无「选中」语义：目录直接打开，文件打开所在目录。
        let target = if p.is_dir() {
            p.clone()
        } else {
            parent_or_err(&p)?
        };
        let mut c = std::process::Command::new("xdg-open");
        c.arg(&target);
        c
    };

    let status = cmd.status().map_err(|e| CommandError {
        msg: format!("failed to launch file manager: {e}"),
    })?;
    if !status.success() {
        return Err(CommandError {
            msg: format!("file manager exited with {status}"),
        });
    }
    Ok(())
}

/// Linux fallback：文件路径取父目录（无父目录视为错误）。
#[cfg(all(unix, not(target_os = "macos")))]
fn parent_or_err(p: &Path) -> CommandResult<PathBuf> {
    p.parent()
        .map(Path::to_path_buf)
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| CommandError {
            msg: format!("no parent directory for {}", p.display()),
        })
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(path: &str, last_used: u64) -> WorkspaceInfo {
        WorkspaceInfo {
            path: path.into(),
            label: path.rsplit('/').next().unwrap_or(path).into(),
            last_used,
            session_count: 0,
        }
    }

    #[test]
    fn upsert_dedupes_refreshes_and_orders() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("workspaces.json");
        upsert_history(&file, entry("/tmp/a", 10)).unwrap();
        upsert_history(&file, entry("/tmp/b", 20)).unwrap();
        // 再次切换 a：去重 + last_used 提到最大。
        upsert_history(&file, entry("/tmp/a", 30)).unwrap();

        let list = read_history(&file);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].path, "/tmp/a");
        assert_eq!(list[0].last_used, 30);
        assert_eq!(list[1].path, "/tmp/b");
    }

    #[test]
    fn upsert_preserves_session_count_of_known_path() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("workspaces.json");
        upsert_history(&file, entry("/tmp/a", 10)).unwrap();
        let mut list = read_history(&file);
        list[0].session_count = 7;
        std::fs::write(&file, serde_json::to_string(&list).unwrap()).unwrap();

        upsert_history(&file, entry("/tmp/a", 20)).unwrap();
        let list = read_history(&file);
        assert_eq!(list[0].session_count, 7, "known path keeps its count");
    }

    #[test]
    fn upsert_caps_history_length() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("workspaces.json");
        for i in 0..(WORKSPACE_HISTORY_CAP + 5) {
            upsert_history(&file, entry(&format!("/tmp/w{i}"), i as u64)).unwrap();
        }
        assert_eq!(read_history(&file).len(), WORKSPACE_HISTORY_CAP);
    }

    #[test]
    fn read_history_tolerates_missing_and_corrupt_file() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_history(&dir.path().join("none.json")).is_empty());
        let file = dir.path().join("workspaces.json");
        std::fs::write(&file, "not json").unwrap();
        assert!(read_history(&file).is_empty());
    }
}
