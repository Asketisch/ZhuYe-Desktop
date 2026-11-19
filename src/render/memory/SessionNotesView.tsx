/**
 * Memory —— 会话笔记面板的显示层。
 */
import { NotebookPen } from 'lucide-react';
import { Card } from '../design-system/Card';
import { EmptyState } from '../design-system/EmptyState';
import { Icon } from '../design-system/Icon';
import { Select } from '../design-system/Select';
import { Spinner } from '../design-system/Spinner';
import type { MemoryViewProps } from '@/contracts/memory';
import s from './MemoryView.module.css';

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function SessionNotesView({ t, sessions, notes, picked, loading, error, onPick }: {
  t: MemoryViewProps['t'];
  sessions: MemoryViewProps['notesSessions'];
  notes: MemoryViewProps['notes'];
  picked: string | null;
  loading: boolean;
  error: string | null;
  onPick: (sessionId: string | null) => void;
}) {
  return (
    <section className={s.notesSection} data-testid="memory-session-notes">
      <h3 className={s.notesTitle}><Icon icon={NotebookPen} size={14} /> {t('notes.title')}</h3>
      {(sessions.length > 0 || picked !== null) && (
        <Select value={picked ?? ''} onChange={(event) => onPick(event.target.value || null)}
          aria-label={t('notes.pickSession')} data-testid="notes-session-picker">
          <option value="">{t('notes.currentSession')}</option>
          {picked && !sessions.some((session) => session.sessionId === picked) && (
            <option value={picked}>{picked.slice(0, 8)}</option>
          )}
          {sessions.map((session) => (
            <option key={session.sessionId} value={session.sessionId}>
              {session.sessionId.slice(0, 8)} · {session.count}
            </option>
          ))}
        </Select>
      )}
      {loading ? (
        <div className={s.loading}><Spinner size={16} /></div>
      ) : error ? (
        <Card level="flat" padding="sm"><p className={s.empty}>{error}</p></Card>
      ) : notes.length === 0 ? (
        <Card level="flat" padding="none"><EmptyState size="sm" icon={<Icon icon={NotebookPen} />}
          title={t('notes.empty')} description={t('notes.emptyHint')} /></Card>
      ) : (
        <ul className={s.notesList} data-testid="notes-list">
          {notes.map((note, index) => (
            <li key={`${note.createdAt}-${index}`} className={s.noteItem}>
              <span className={s.noteTime}>{formatTime(note.createdAt)}</span>
              <span className={s.noteText}>{note.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
