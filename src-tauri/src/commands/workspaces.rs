//! Workspace 命令。
//!
//! - 列表持久化在 `~/.zhuye/workspaces.json`（`[WorkspaceInfo]` 数组）；
//!   `reflect_set_workspace` 每次切换 upsert 该文件，作为「最近项目」历史。
//! - `reflect_pick_workspace_folder` 走 `tauri-plugin-dialog` 的 Rust 侧
//!   API 弹原生目录选择框 —— 不经 JS IPC，无需 dialog capability。
//! - `reflect_reveal_path` 在系统文件管理器中定位路径（macOS Finder /
//!   Windows 资源管理器 / Linux xdg-open）。

use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_dialog::DialogExt;

use crate::commands::error::{CommandError, CommandResult};
use crate::state::MinimalAgent;

/// 「最近项目」历史的最大保留条数。
const WORKSPACE_HISTORY_CAP: usize = 20;
static HISTORY_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceInfo {
    pub path: String,
    pub label: String,
    pub last_used: u64,
    pub session_count: usize,
    #[serde(default)]
    pub hidden: bool,
}

/// v1.11 桌面#5:多目录综合工作区状态(camelCase 出线)。
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDirsInfo {
    /// 主工作区(规范根:memory / skills / rollout 相对它)。
    pub main: String,
    /// 附加目录(拼进 sandbox_writable,文件工具边界放行)。
    pub additional: Vec<String>,
}

fn workspaces_file() -> Option<PathBuf> {
    reflect_config::paths::data_path(&["workspaces.json"])
}

/// 不存在时返回空表；读取或解析失败时保留原文件并报告错误。
fn read_history(path: &Path) -> CommandResult<Vec<WorkspaceInfo>> {
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    serde_json::from_str(&raw).map_err(|error| CommandError {
        msg: format!("read {}: {error}", path.display()),
    })
}

/// upsert 一条 workspace 记录（同 path 去重、last_used 刷新、按最近使用
/// 倒序、截断到 [`WORKSPACE_HISTORY_CAP`]）并写回。
///
/// v1.x 修复:`unhide = false`(常规切换,含「点击旧会话跟随工作区」)时
/// **保留**既有条目的 `hidden` —— 已移除的工作区不再因 incidental 切换
/// 复活;显式恢复走 `unhide = true`(工作区管理页「恢复」)。
fn upsert_history(path: &Path, entry: WorkspaceInfo, unhide: bool) -> CommandResult<()> {
    let mut list = read_history(path)?;
    let prev = list.iter().find(|w| w.path == entry.path);
    let prev_count = prev.map_or(0, |w| w.session_count);
    let mut entry = entry;
    entry.session_count = prev_count;
    if !unhide && let Some(prev) = prev {
        entry.hidden = prev.hidden;
    }
    list.retain(|w| w.path != entry.path);
    list.insert(0, entry);
    list.sort_by_key(|a| std::cmp::Reverse(a.last_used));
    let mut visible = 0;
    list.retain(|entry| {
        if entry.hidden {
            return true;
        }
        visible += 1;
        visible <= WORKSPACE_HISTORY_CAP
    });
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(&list).map_err(|e| CommandError {
        msg: format!("serialize workspaces.json: {e}"),
    })?;
    crate::persistence::write_atomic(path, json.as_bytes())?;
    Ok(())
}

/// 列出已知 workspace（从 `~/.zhuye/workspaces.json` 读取）。
#[tauri::command]
pub async fn reflect_list_workspaces() -> CommandResult<Vec<WorkspaceInfo>> {
    let _guard = HISTORY_LOCK.lock();
    let path = workspaces_file().ok_or_else(|| CommandError {
        msg: "no HOME dir".into(),
    })?;
    let list = read_history(&path)?;
    if list.is_empty() {
        // 无历史时仅返回当前 workspace，保证视图有可切换的落点。
        let cur =
            dirs::home_dir().map_or_else(|| ".".to_string(), |h| h.join(".").display().to_string());
        return Ok(vec![WorkspaceInfo {
            path: cur,
            label: "default".to_string(),
            last_used: 0,
            session_count: 0,
            hidden: false,
        }]);
    }
    Ok(list)
}

#[tauri::command]
pub async fn reflect_set_workspace(
    agent: State<'_, MinimalAgent>,
    path: String,
    unhide: Option<bool>,
) -> CommandResult<()> {
    let _transition = agent.inner.session_transition_lock.lock().await;
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
    // `unhide = Some(true)`:显式恢复已移除的工作区(管理页「恢复」);
    // 缺省/Some(false):保留既有 hidden 状态(incidental 切换不复活)。
    if let Some(hist) = workspaces_file() {
        let _guard = HISTORY_LOCK.lock();
        let label = p
            .file_name()
            .map_or_else(|| path.clone(), |n| n.to_string_lossy().into_owned());
        let entry = WorkspaceInfo {
            path: path.clone(),
            label,
            last_used: unix_now(),
            session_count: 0,
            hidden: false,
        };
        if let Err(e) = upsert_history(&hist, entry, unhide.unwrap_or(false)) {
            // 历史写失败不阻断切换 —— workspace 本身已生效。
            tracing::warn!("[reflect-gui] persist workspace history failed: {}", e.msg);
        }
    }
    agent.set_workspace(p);
    Ok(())
}

/// v1.x 修复:占位路径条目("/", "//", ".", "/.", 空串)不进历史长期留存。
/// 与前端 `isPlaceholderWorkspace` 同口径(尾斜杠剥离后判空 / "." / 任意 "/.")。
fn is_placeholder_workspace_path(path: &str) -> bool {
    let stripped = path.trim().trim_end_matches(['/', '\\']);
    stripped.is_empty() || stripped == "." || stripped.ends_with("/.") || stripped.ends_with("\\.")
}

/// v1.x 修复:按规范化路径匹配把所有变体(相对/绝对、尾斜杠、符号链接)
/// 一并标记 hidden。返回是否有命中 —— 无命中时调用方补一条 hidden 记录
/// (维持幂等:对不在历史里的路径 remove 依然静默成功)。
fn hide_workspace_variants(list: &mut [WorkspaceInfo], path: &str) -> bool {
    let target = PathBuf::from(path);
    let mut matched = false;
    for entry in list.iter_mut() {
        if crate::workspace_state::same_path(Path::new(&entry.path), &target) {
            entry.hidden = true;
            matched = true;
        }
    }
    matched
}

/// 从项目列表移除目录，保留磁盘文件和会话；工作区管理页「恢复」可重新显示。
///
/// v1.x 修复:① 规范化路径匹配 —— 历史 json 里混有相对/绝对/尾斜杠等
/// 变体时精确字符串匹配只命中其一,可见组来自另一变体,表现为「删不掉」;
/// ② 顺手清理占位条目("/", ".", 空串)。
#[tauri::command]
pub async fn reflect_remove_workspace(path: String) -> CommandResult<()> {
    let _guard = HISTORY_LOCK.lock();
    let file = workspaces_file().ok_or_else(|| CommandError {
        msg: "no HOME dir".into(),
    })?;
    let mut list = read_history(&file)?;
    if !hide_workspace_variants(&mut list, &path) {
        list.push(WorkspaceInfo {
            label: path.clone(),
            path,
            last_used: 0,
            session_count: 0,
            hidden: true,
        });
    }
    list.retain(|entry| !is_placeholder_workspace_path(&entry.path));
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_vec_pretty(&list).map_err(|e| CommandError { msg: e.to_string() })?;
    crate::persistence::write_atomic(&file, &json)?;
    Ok(())
}

#[tauri::command]
pub async fn reflect_current_workspace(agent: State<'_, MinimalAgent>) -> CommandResult<String> {
    Ok(agent.workspace().display().to_string())
}

// ── v1.11 桌面#5:多目录综合工作区 ─────────────────────────────────────

/// 设置主工作区之外的**附加目录**集(全量覆盖)。
///
/// 语义:多个目录合成一个项目 —— 主工作区仍是规范根(memory / skills /
/// rollout 相对它),附加目录拼进 `AgentConfig.sandbox_writable`
/// (`[sandbox].writable_dirs` 同源),文件类工具的沙箱边界对其放行。
/// 传空数组 = 清空(回到单目录)。新绑定的会话生效(既有会话不受影响,
/// 与 workspace 切换的 bind 语义一致)。
#[tauri::command]
pub async fn reflect_set_workspace_dirs(
    agent: State<'_, MinimalAgent>,
    main: String,
    additional: Vec<String>,
) -> CommandResult<()> {
    let _transition = agent.inner.session_transition_lock.lock().await;
    let main_path = PathBuf::from(&main);
    if !main_path.exists() {
        return Err(CommandError {
            msg: format!("workspace path does not exist: {main}"),
        });
    }
    if !main_path.is_dir() {
        return Err(CommandError {
            msg: format!("workspace path is not a directory: {main}"),
        });
    }
    // 附加目录逐个校验存在 + 是目录 + 不等于主工作区(重复无意义)。
    let mut extra: Vec<PathBuf> = Vec::new();
    for dir in &additional {
        let p = PathBuf::from(dir);
        if !p.exists() {
            return Err(CommandError {
                msg: format!("additional dir does not exist: {dir}"),
            });
        }
        if !p.is_dir() {
            return Err(CommandError {
                msg: format!("additional path is not a directory: {dir}"),
            });
        }
        if crate::workspace_state::same_path(&p, &main_path) {
            continue; // 与主工作区相同 → 跳过(幂等,不报错)
        }
        if extra
            .iter()
            .any(|x| crate::workspace_state::same_path(x, &p))
        {
            continue; // 重复项去重
        }
        extra.push(p);
    }
    // 切换主工作区 + 重置附加目录(合成项目整体更新)。
    agent.set_workspace(main_path);
    crate::workspace_state::WorkspaceState::set_additional_dirs(extra);
    Ok(())
}

/// 读取当前多目录综合工作区状态(主 + 附加)。
#[tauri::command]
pub async fn reflect_current_workspace_dirs(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<WorkspaceDirsInfo> {
    Ok(WorkspaceDirsInfo {
        main: agent.workspace().display().to_string(),
        additional: crate::workspace_state::WorkspaceState::additional_dirs()
            .into_iter()
            .map(|p| p.display().to_string())
            .collect(),
    })
}

/// 弹出原生目录选择框，返回用户选择的项目目录；取消 → `None`。
///
/// 对话框由插件分发到主线程；这里用 oneshot 把回调折叠回 async 返回值，
/// 不阻塞 tokio worker。
///
/// 应用句柄从托管状态取(而非直接当参数)—— 命令签名不与 runtime 绑死,
/// 能力覆盖层才能用 mock runtime 驱动真实命令体。句柄缺失时返回错误
/// (原生对话框在无桌面 runtime 下本就无法弹出)。
#[tauri::command]
pub async fn reflect_pick_workspace_folder(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<Option<String>> {
    let app = agent.app_handle().ok_or_else(|| CommandError {
        msg: "native folder picker unavailable: app handle not installed".into(),
    })?;
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
    agent: State<'_, MinimalAgent>,
    extensions: Option<Vec<String>>,
) -> CommandResult<Option<String>> {
    let app = agent.app_handle().ok_or_else(|| CommandError {
        msg: "native file picker unavailable: app handle not installed".into(),
    })?;
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
        .map_or(0, |d| d.as_secs())
}

#[cfg(test)]
mod tests;
