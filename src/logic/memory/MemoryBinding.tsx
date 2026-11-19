/**
 * Memory —— 记忆控制器、活动 agent、记忆分段与会话笔记的绑定。
 */
import { useState } from 'react';
import type { ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/utils/i18n';
import { reflect_get_active_agent } from '@/utils/commands/agents';
import { reflect_memory_sections } from '@/utils/commands/runtimeStatus';
import { reflect_list_note_sessions, reflect_list_session_notes } from '@/utils/commands/notes';
import { useAgentStore } from '@/stores/agentStore';
import { FILTERS, MEMORY_SECTIONS_QUERY_KEY, SCOPE_KEYS, useMemoryController, entryKey } from './useMemoryController';
import { memoryEntryKey } from '@/contracts/memory';
import type { MemoryViewProps } from '@/contracts/memory';

function noteErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'msg' in error && typeof error.msg === 'string') return error.msg;
  return String(error);
}

export function MemoryBinding({ view: View }: { view: ComponentType<MemoryViewProps> }) {
  const { t } = useI18n();
  const ctrl = useMemoryController({ t });
  const boundSessionId = useAgentStore((st) => st.loadedSessionId ?? null);
  const [picked, setPicked] = useState<string | null>(null);

  const activeQ = useQuery({ queryKey: ['active-agent'], queryFn: () => reflect_get_active_agent(), staleTime: 30_000 });
  const scopes = activeQ.data?.memoryScopes ?? [];
  const missingScopes = (['project', 'user'] as const).filter((scope) => !scopes.includes(scope));
  const scopeWarning = activeQ.data && missingScopes.length > 0
    ? t('memory.scopeNotDeclared', {
        agent: activeQ.data.name,
        missing: missingScopes.map((scope) => t(SCOPE_KEYS[scope])).join(', '),
        scopes: activeQ.data.memoryScopes.join(', ') || '—',
      })
    : null;

  const sectionsQ = useQuery({
    queryKey: [...MEMORY_SECTIONS_QUERY_KEY, ctrl.context],
    queryFn: () => reflect_memory_sections(ctrl.context!),
    enabled: ctrl.context !== null,
    staleTime: 10_000,
  });
  const sections = sectionsQ.isError ? [] : sectionsQ.data ?? [];
  const injectBudget = activeQ.data?.injectBudgetChars ?? 0;
  const usedChars = sections.reduce((sum, x) => sum + x.chars, 0);

  const sessionsQ = useQuery({ queryKey: ['note-sessions'], queryFn: () => reflect_list_note_sessions(), staleTime: 10_000, refetchInterval: 10_000 });
  const target = picked ?? boundSessionId;
  const notesQ = useQuery({
    queryKey: ['session-notes', target],
    queryFn: () => reflect_list_session_notes(target as string),
    enabled: !!target,
    staleTime: 5_000,
    refetchInterval: 5_000,
  });

  const orphanDrafts = ctrl.savedDrafts
    .filter((draft) => !ctrl.entries.some((entry) => entryKey(entry) === entryKey(draft.entry)))
    .map((draft) => ({ entry: draft.entry, value: draft.value }));

  return <View
    t={t}
    scopeWarning={scopeWarning}
    filters={FILTERS}
    activeFilter={ctrl.filter}
    counts={ctrl.counts}
    showForm={ctrl.showForm}
    canAdd={ctrl.context !== null}
    newScope={ctrl.newScope}
    newKey={ctrl.newKey}
    newValue={ctrl.newValue}
    loading={ctrl.loading}
    error={Boolean(ctrl.error)}
    entries={ctrl.filtered}
    editKey={ctrl.editingKey}
    editValue={ctrl.editValue}
    isMutating={ctrl.isMutating}
    orphanDrafts={orphanDrafts}
    sections={sections}
    injectBudget={injectBudget}
    usedChars={usedChars}
    notesSessions={(sessionsQ.data ?? []).map((s) => ({ sessionId: s.sessionId, count: s.count }))}
    notes={(notesQ.data ?? []).map((n) => ({ createdAt: n.createdAt, text: n.text }))}
    notesPicked={picked}
    notesLoading={notesQ.isLoading}
    notesError={notesQ.isError ? noteErrorMessage(notesQ.error) : null}
    memorySectionsError={Boolean(sectionsQ.isError)}
    entryKey={memoryEntryKey}
    onFilter={(scope) => ctrl.setFilter(scope as typeof ctrl.filter)}
    onToggleForm={ctrl.toggleShowForm}
    onNewScope={ctrl.setNewScope}
    onNewKey={ctrl.setNewKey}
    onNewValue={ctrl.setNewValue}
    onSubmitNew={() => { void ctrl.addNew(); }}
    onBeginEdit={ctrl.beginEdit}
    onChangeEdit={ctrl.setEditValue}
    onSaveEdit={(entry) => { void ctrl.saveEdit(entry); }}
    onCancelEdit={ctrl.cancelEdit}
    onRemove={(entry) => { void ctrl.remove(entry); }}
    onDiscardDraft={ctrl.discardEdit}
    onPickNotesSession={setPicked}
  />;
}
