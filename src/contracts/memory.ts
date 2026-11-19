import type { I18nContextValue } from '@/utils/i18n/context';
import type { ReflectMemoryEntry } from '@/utils/commands/memory';
export type { ReflectMemoryEntry } from '@/utils/commands/memory';
import type { MemorySectionInfo } from '@/utils/commands/runtimeStatus';

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
  entries: ReflectMemoryEntry[];
  editKey: string | null;
  editValue: string;
  isMutating: boolean;
  orphanDrafts: Array<{ entry: ReflectMemoryEntry; value: string }>;
  sections: MemorySectionView[];
  injectBudget: number;
  usedChars: number;
  notesSessions: SessionNoteListView[];
  notes: SessionNoteView[];
  notesPicked: string | null;
  notesLoading: boolean;
  notesError: string | null;
  memorySectionsError: boolean;
  entryKey: (entry: ReflectMemoryEntry) => string;
  onFilter: (scope: string) => void;
  onToggleForm: () => void;
  onNewScope: (scope: 'user' | 'project') => void;
  onNewKey: (value: string) => void;
  onNewValue: (value: string) => void;
  onSubmitNew: () => void;
  onBeginEdit: (entry: ReflectMemoryEntry) => void;
  onChangeEdit: (value: string) => void;
  onSaveEdit: (entry: ReflectMemoryEntry) => void;
  onCancelEdit: () => void;
  onRemove: (entry: ReflectMemoryEntry) => void;
  onDiscardDraft: (entry: ReflectMemoryEntry) => void;
  onPickNotesSession: (sessionId: string | null) => void;
}

/** memory 条目的稳定 key（渲染与草稿定位共用）。 */
export function memoryEntryKey(entry: ReflectMemoryEntry): string {
  return `${entry.scope}:${entry.key}`;
}
