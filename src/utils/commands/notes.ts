/**
 * 会话笔记 IPC 包装。
 *
 * agent 运行时经 `AddSessionNoteTool`(`reflect-notes`)把结论写进
 * `<notes_home>/session-notes/<thread_id>.jsonl`。此前这条链路只有写、
 * 没有读 —— GUI 补上读取侧,让「agent 记了什么」可见。
 */
import { invoke } from '../bridge';

/** 一条会话笔记。 */
export interface SessionNoteInfo {
  /** 笔记正文。 */
  text: string;
  /** 写入时间(RFC3339)。 */
  createdAt: string;
}

/** 一个有笔记的会话。 */
export interface NoteSessionInfo {
  /** 会话 id(ThreadId uuid)。 */
  sessionId: string;
  /** 当前可读取的笔记条数（最多核心的会话容量）。 */
  count: number;
  /** 最后写入时间(RFC3339);无时间戳时为 null。 */
  updatedAt?: string | null;
}

/** 列出某会话最近的有效笔记(按写入顺序,最新在后);没有笔记时返回空数组。 */
export function reflect_list_session_notes(id: string): Promise<SessionNoteInfo[]> {
  return invoke('reflect_list_session_notes', { id });
}

/** 列出所有有笔记的会话(按最后写入时间降序)。 */
export function reflect_list_note_sessions(): Promise<NoteSessionInfo[]> {
  return invoke('reflect_list_note_sessions');
}
