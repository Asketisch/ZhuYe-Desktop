/**
 * SessionNotes —— 会话笔记面板(agent 写下的持久笔记)。
 *
 * agent 运行时经 `AddSessionNoteTool`(`reflect-notes`)把结论写进
 * `<notes_home>/session-notes/<thread_id>.jsonl`。这条链路此前**只有写、
 * 没有读** —— 用户看不到 agent 记了什么。本面板补上读取侧。
 *
 * 面板挂在 Memory 视图下:两者都是「agent 的持久认知」,但作用域不同
 * (memory = 跨会话的长期记忆;notes = 单会话的结论沉淀)。
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NotebookPen } from 'lucide-react';
import { Card, EmptyState, Icon, Select, Spinner } from '@/features/design-system';
import { useAgentStore } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';
import {
  reflect_list_note_sessions,
  reflect_list_session_notes,
} from '@/utils/commands/notes';
import s from './MemoryView.module.css';

export function SessionNotes() {
  const { t } = useI18n();
  const boundSessionId = useAgentStore((st) => st.loadedSessionId ?? null);
  const [picked, setPicked] = useState<string | null>(null);

  const sessionsQ = useQuery({
    queryKey: ['note-sessions'],
    queryFn: () => reflect_list_note_sessions(),
    staleTime: 10_000,
    refetchInterval: 10_000,
  });

  // 默认展示当前绑定会话的笔记;用户也可切到其它有笔记的会话。
  const target = picked ?? boundSessionId;
  const notesQ = useQuery({
    queryKey: ['session-notes', target],
    queryFn: () => reflect_list_session_notes(target as string),
    enabled: !!target,
    staleTime: 5_000,
    refetchInterval: 5_000,
  });

  const sessions = sessionsQ.data ?? [];
  const notes = notesQ.data ?? [];

  return (
    <section className={s.notesSection} data-testid="memory-session-notes">
      <h3 className={s.notesTitle}>
        <Icon icon={NotebookPen} size={14} />
        {t('notes.title')}
      </h3>

      {sessionsQ.isError && (
        <Card level="flat" padding="sm"><p className={s.empty}>{t('notes.sessionsFailed')}</p></Card>
      )}

      {(sessions.length > 0 || picked !== null) && (
        <Select
          value={picked ?? ''}
          onChange={(e) => setPicked(e.target.value || null)}
          aria-label={t('notes.pickSession')}
          data-testid="notes-session-picker"
        >
          <option value="">{t('notes.currentSession')}</option>
          {picked && !sessions.some((session) => session.sessionId === picked) && (
            <option value={picked}>{picked.slice(0, 8)}</option>
          )}
          {sessions.map((s) => (
            <option key={s.sessionId} value={s.sessionId}>
              {s.sessionId.slice(0, 8)} · {s.count}
            </option>
          ))}
        </Select>
      )}

      {notesQ.isLoading ? (
        <div className={s.loading}>
          <Spinner size={16} />
        </div>
      ) : notesQ.isError ? (
        <Card level="flat" padding="sm">
          <p className={s.empty}>
            {noteErrorMessage(notesQ.error)}
          </p>
        </Card>
      ) : notes.length === 0 ? (
        <Card level="flat" padding="none">
          <EmptyState
            size="sm"
            icon={<Icon icon={NotebookPen} />}
            title={t('notes.empty')}
            description={t('notes.emptyHint')}
          />
        </Card>
      ) : (
        <ul className={s.notesList} data-testid="notes-list">
          {notes.map((n, i) => (
            <li key={`${n.createdAt}-${i}`} className={s.noteItem}>
              <span className={s.noteTime}>{formatTime(n.createdAt)}</span>
              <span className={s.noteText}>{n.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function noteErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'msg' in error && typeof error.msg === 'string') return error.msg;
  return String(error);
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
