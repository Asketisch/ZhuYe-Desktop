//! 会话笔记只读查询 —— 让 agent 写下的持久笔记在 GUI 里可见。
//!
//! agent 运行时经 `AddSessionNoteTool`(`reflect-notes`)把结论写进
//! `<notes_home>/session-notes/<thread_id>.jsonl`,`notes_home` 的解析顺序
//! 是 `$ZHUYE_HOME` > `$HOME/.zhuye`(与核心 `resolve_notes_home()` 一致)。
//!
//! 此前这条链路**只有写、没有读** —— agent 记了什么、跨重启还在不在,
//! 用户完全看不到。本模块补上读取侧(只读,不提供写入口:写入仍由 agent
//! 经工具发起,GUI 不代劳)。

use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
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
    read_notes(&path)
}

/// 列出所有有笔记的会话(按最后写入时间降序)。
#[tauri::command]
pub async fn reflect_list_note_sessions(
    _agent: State<'_, MinimalAgent>,
) -> CommandResult<Vec<NoteSessionInfo>> {
    let Some(dir) = notes_dir() else {
        return Ok(Vec::new());
    };
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let mut out: Vec<NoteSessionInfo> = Vec::new();
    for entry in entries {
        let entry = entry?;
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
        let notes = read_notes(&path)?;
        if notes.is_empty() {
            continue;
        }
        out.push(NoteSessionInfo {
            session_id: stem.to_string(),
            count: notes.len(),
            updated_at: notes.last().map(|note| note.created_at.clone()),
        });
    }
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then(b.count.cmp(&a.count)));
    Ok(out)
}

/// 与核心重建窗口及内容校验一致，同时保留文件中的原始时间。
fn read_notes(path: &Path) -> CommandResult<Vec<SessionNoteInfo>> {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let cap = reflect_notes::SESSION_NOTE_CAP;
    let mut candidates = VecDeque::with_capacity(cap * 2);
    for line in BufReader::new(file).lines() {
        let line = match line {
            Ok(line) => line,
            Err(error) if error.kind() == std::io::ErrorKind::InvalidData => continue,
            Err(error) => return Err(error.into()),
        };
        let Ok(note) = serde_json::from_str::<reflect_notes::SessionNote>(&line) else {
            continue;
        };
        if candidates.len() == cap * 2 {
            candidates.pop_front();
        }
        candidates.push_back(note);
    }
    let validator = reflect_notes::InMemoryNoteStore::new();
    let mut notes = VecDeque::with_capacity(cap);
    for note in candidates {
        let Ok(validated) = validator.add(note.text) else {
            continue;
        };
        if notes.len() == cap {
            notes.pop_front();
        }
        notes.push_back(SessionNoteInfo {
            text: validated.text,
            created_at: note.created_at.to_rfc3339(),
        });
    }
    Ok(notes.into())
}
