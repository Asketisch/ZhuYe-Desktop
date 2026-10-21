//! 会话笔记只读查询 —— 让 agent 写下的持久笔记在 GUI 里可见。
//!
//! agent 运行时经 `AddSessionNoteTool`(`reflect-notes`)把结论写进
//! `<notes_home>/session-notes/<thread_id>.jsonl`,`notes_home` 的解析顺序
//! 是 `$REFLECT_HOME` > `$HOME/.reflect`(与核心 `resolve_notes_home()` 一致)。
//!
//! 此前这条链路**只有写、没有读** —— agent 记了什么、跨重启还在不在,
//! 用户完全看不到。本模块补上读取侧(只读,不提供写入口:写入仍由 agent
//! 经工具发起,GUI 不代劳)。

use std::path::{Path, PathBuf};

use reflect_notes::NoteStore;
use reflect_protocol::ThreadId;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::error::CommandResult;
use crate::state::MinimalAgent;

/// 一条会话笔记(camelCase 出线)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionNoteInfo {
    /// 笔记正文。
    pub text: String,
    /// 写入时间(RFC3339)。
    pub created_at: String,
}

/// 一个有笔记的会话(camelCase 出线)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSessionInfo {
    /// 会话 id(ThreadId uuid)。
    pub session_id: String,
    /// 笔记条数。
    pub count: usize,
    /// 最后写入时间(RFC3339);无时间戳时为 null。
    pub updated_at: Option<String>,
}

/// 笔记目录(`<notes_home>/session-notes`)。
fn notes_dir() -> Option<PathBuf> {
    reflect_notes::resolve_notes_home().map(|h| h.join("session-notes"))
}

/// 某会话的笔记文件路径。
fn note_path(id: &ThreadId) -> Option<PathBuf> {
    Some(notes_dir()?.join(format!("{id}.jsonl")))
}

/// 列出某会话的笔记(按写入顺序,最新在后)。
///
/// 文件不存在(该会话没写过笔记)→ 返回空列表,不报错。
#[tauri::command]
pub async fn reflect_list_session_notes(
    _agent: State<'_, MinimalAgent>,
    id: ThreadId,
) -> CommandResult<Vec<SessionNoteInfo>> {
    let Some(path) = note_path(&id) else {
        return Ok(Vec::new());
    };
    if !path.exists() {
        return Ok(Vec::new());
    }
    // 复用核心的 store 做 rehydrate —— 坏行跳过、空文本/超长跳过等
    // 容错语义与运行时一致,不在命令层另写一份解析。
    let store = match reflect_notes::FileBackedNoteStore::open_or_create_default(&path) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(error = %e, path = %path.display(), "打开会话笔记失败");
            return Ok(Vec::new());
        }
    };
    let out = store
        .list()
        .into_iter()
        .map(|n| SessionNoteInfo {
            text: n.text,
            created_at: n.created_at.to_rfc3339(),
        })
        .collect();
    Ok(out)
}

/// 列出所有有笔记的会话(按最后写入时间降序)。
#[tauri::command]
pub async fn reflect_list_note_sessions(
    _agent: State<'_, MinimalAgent>,
) -> CommandResult<Vec<NoteSessionInfo>> {
    let Some(dir) = notes_dir() else {
        return Ok(Vec::new());
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };
    let mut out: Vec<NoteSessionInfo> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        // 文件名必须是合法 session id —— 目录里可能有用户手放的文件。
        if ThreadId::parse_str(stem).is_err() {
            continue;
        }
        let (count, updated_at) = count_notes(&path);
        out.push(NoteSessionInfo {
            session_id: stem.to_string(),
            count,
            updated_at,
        });
    }
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then(b.count.cmp(&a.count)));
    Ok(out)
}

/// 统计某笔记文件的条数与最后写入时间。
fn count_notes(path: &Path) -> (usize, Option<String>) {
    let Ok(body) = std::fs::read_to_string(path) else {
        return (0, None);
    };
    let mut count = 0usize;
    let mut last: Option<String> = None;
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        // 每行是一个 `{"text": ..., "created_at": ...}` JSON 记录。
        let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            continue;
        };
        count += 1;
        if let Some(ts) = v.get("created_at").and_then(|t| t.as_str()) {
            last = Some(ts.to_string());
        }
    }
    (count, last)
}
