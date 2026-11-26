import type { I18nContextValue } from '@/utils/i18n/context';
import type { ZhuyeMemoryEntry } from '@/utils/commands/knowledge/memory';
export type { ZhuyeMemoryEntry } from '@/utils/commands/knowledge/memory';
import type { MemorySectionInfo } from '@/utils/commands/harness/runtimeStatus';

export type MemoryCounts = Record<string, number>;
export interface MemorySectionView extends MemorySectionInfo {}
export interface SessionNoteListView { sessionId: string; count: number }
export interface SessionNoteView { createdAt: string; text: string }
export interface MemoryViewProps {
  t: I18nContextValue['t'];
  scopeWarning: string | null;
  filters: string[];
  activeFilter: string;
  counts: MemoryCounts;
  showForm: boolean;
  canAdd: boolean;
  newScope: 'user' | 'project';
  newKey: string;
  newValue: string;
  loading: boolean;
  error: boolean;
  entries: ZhuyeMemoryEntry[];
  editKey: string | null;
  editValue: string;
  isMutating: boolean;
  orphanDrafts: Array<{ entry: ZhuyeMemoryEntry; value: string }>;
  sections: MemorySectionView[];
  injectBudget: number;
  usedChars: number;
  notesSessions: SessionNoteListView[];
  notes: SessionNoteView[];
  notesPicked: string | null;
  notesLoading: boolean;
  notesError: string | null;
  memorySectionsError: boolean;
  entryKey: (entry: ZhuyeMemoryEntry) => string;
  onFilter: (scope: string) => void;
  onToggleForm: () => void;
  onNewScope: (scope: 'user' | 'project') => void;
  onNewKey: (value: string) => void;
  onNewValue: (value: string) => void;
  onSubmitNew: () => void;
  onBeginEdit: (entry: ZhuyeMemoryEntry) => void;
  onChangeEdit: (value: string) => void;
  onSaveEdit: (entry: ZhuyeMemoryEntry) => void;
  onCancelEdit: () => void;
  onRemove: (entry: ZhuyeMemoryEntry) => void;
  onDiscardDraft: (entry: ZhuyeMemoryEntry) => void;
  onPickNotesSession: (sessionId: string | null) => void;
}

/** memory 条目的稳定 key（渲染与草稿定位共用）。 */
export function memoryEntryKey(entry: ZhuyeMemoryEntry): string {
  return `${entry.scope}:${entry.key}`;
}
