import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup';
import { useAgentStore } from '@/stores/agentStore';
import { useMemoryController } from './useMemoryController';
import { useMemoryDraftStore } from './memoryDraftStore';

function setup(t: (key: string, vars?: Record<string, string | number>) => string = (key) => key) {
  const client = createTestQueryClient();
  const hook = renderHook(() => useMemoryController({ t }), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  return { ...hook, client };
}

beforeEach(() => {
  resetMockInvoke();
  useMemoryDraftStore.setState({ editSessions: {}, formDrafts: {} });
  useAgentStore.getState().reset();
  mockInvoke('reflect_list_memory', async () => []);
  mockInvoke('reflect_current_workspace', async () => '/workspace');
  mockInvoke('reflect_get_active_agent', async () => ({ name: 'default' }));
});

it('keeps a conflicting edit and displays a serialized backend error', async () => {
  mockInvoke('reflect_add_memory', async () => { throw { msg: 'memory entry changed' }; });
  const { result } = setup((key, vars) => `${key}: ${vars?.msg ?? ''}`);
  await waitFor(() => expect(result.current.loading).toBe(false));
  const entry = { scope: 'project', key: 'one', value: 'original' };
  act(() => { result.current.beginEdit(entry); result.current.setEditValue('draft'); });
  await act(async () => result.current.saveEdit(entry));
  expect(result.current.editValue).toBe('draft');
  expect(result.current.editingKey).toBe('project:one');
  expect(useAgentStore.getState().toasts.at(-1)?.message).toBe('memory.toast.updateFail: memory entry changed');
});

it('reloads for a new workspace and retains the original context of an edit', async () => {
  const reads: string[] = [];
  const writes: unknown[] = [];
  mockInvoke('reflect_list_memory', async (_command, args) => {
    const workspace = (args?.expectedContext as { workspace: string }).workspace;
    reads.push(workspace);
    return [{ scope: 'project', key: 'same', value: workspace }];
  });
  mockInvoke('reflect_add_memory', async (_command, args) => {
    writes.push(args);
    throw new Error('memory workspace or active agent changed');
  });
  const { result, client } = setup();
  await waitFor(() => expect(result.current.entries[0]?.value).toBe('/workspace'));
  act(() => { result.current.beginEdit(result.current.entries[0]); result.current.setEditValue('draft'); });
  act(() => client.setQueryData(['current-workspace'], '/other'));
  await waitFor(() => expect(result.current.entries[0]?.value).toBe('/other'));
  expect(result.current.editingKey).toBeNull();
  act(() => { result.current.beginEdit(result.current.entries[0]); result.current.setEditValue('other draft'); });
  act(() => client.setQueryData(['current-workspace'], '/workspace'));
  await waitFor(() => expect(result.current.entries[0]?.value).toBe('/workspace'));
  expect(result.current.editValue).toBe('draft');
  await act(async () => result.current.saveEdit(result.current.entries[0]));
  expect(reads.slice(0, 2)).toEqual(['/workspace', '/other']);
  expect(writes).toEqual([expect.objectContaining({ value: 'draft', expectedValue: '/workspace', expectedContext: { workspace: '/workspace', agent: 'default' } })]);
  expect(result.current.editValue).toBe('draft');
  act(() => client.setQueryData(['current-workspace'], '/other'));
  await waitFor(() => expect(result.current.editValue).toBe('other draft'));
});

it('restores drafts after the memory view unmounts and remounts', async () => {
  const first = setup();
  await waitFor(() => expect(first.result.current.loading).toBe(false));
  const entry = { scope: 'project', key: 'one', value: 'original' };
  act(() => {
    first.result.current.beginEdit(entry);
    first.result.current.setEditValue('edit draft');
    first.result.current.toggleShowForm();
    first.result.current.setNewKey('new key');
  });
  first.unmount();
  const second = setup();
  await waitFor(() => expect(second.result.current.loading).toBe(false));
  expect(second.result.current.editingKey).toBe('project:one');
  expect(second.result.current.editValue).toBe('edit draft');
  expect(second.result.current.newKey).toBe('new key');
  expect(second.result.current.showForm).toBe(true);
});

it('does not clear a newer draft when a save finishes after remount', async () => {
  let finish!: () => void;
  mockInvoke('reflect_add_memory', () => new Promise<void>((resolve) => { finish = resolve; }));
  const first = setup();
  await waitFor(() => expect(first.result.current.loading).toBe(false));
  const entry = { scope: 'project', key: 'one', value: 'original' };
  act(() => first.result.current.beginEdit(entry));
  let save!: Promise<void>;
  act(() => { save = first.result.current.saveEdit(entry); });
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  first.unmount();
  const second = setup();
  await waitFor(() => expect(second.result.current.loading).toBe(false));
  act(() => second.result.current.setEditValue('newer draft'));
  await act(async () => { finish(); await save; });
  expect(second.result.current.editingKey).toBe('project:one');
  expect(second.result.current.editValue).toBe('newer draft');
});

it('uses the saved value as the base for edits made during the save', async () => {
  let finish!: () => void;
  const writes: Array<Record<string, unknown> | undefined> = [];
  mockInvoke('reflect_add_memory', (_command, args) => {
    writes.push(args);
    if (writes.length === 1) return new Promise<void>((resolve) => { finish = resolve; });
    return Promise.resolve();
  });
  const { result } = setup();
  await waitFor(() => expect(result.current.loading).toBe(false));
  const entry = { scope: 'project', key: 'one', value: 'original' };
  act(() => { result.current.beginEdit(entry); result.current.setEditValue('first save'); });
  let save!: Promise<void>;
  act(() => { save = result.current.saveEdit(entry); });
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  act(() => result.current.setEditValue('later draft'));
  await act(async () => { finish(); await save; });
  expect(result.current.editValue).toBe('later draft');
  await act(async () => result.current.saveEdit(entry));
  expect(writes[1]).toMatchObject({ value: 'later draft', expectedValue: 'first save' });
});

it('keeps separate new-entry forms for workspace and active agent', async () => {
  const { result, client } = setup();
  await waitFor(() => expect(result.current.loading).toBe(false));
  act(() => { result.current.toggleShowForm(); result.current.setNewKey('project A'); result.current.setNewValue('draft A'); });
  act(() => client.setQueryData(['current-workspace'], '/other'));
  await waitFor(() => expect(result.current.context?.workspace).toBe('/other'));
  expect(result.current.showForm).toBe(false);
  act(() => { result.current.toggleShowForm(); result.current.setNewKey('project B'); });
  act(() => client.setQueryData(['active-agent'], { name: 'second' }));
  await waitFor(() => expect(result.current.context?.agent).toBe('second'));
  expect(result.current.showForm).toBe(false);
  act(() => client.setQueryData(['current-workspace'], '/workspace'));
  act(() => client.setQueryData(['active-agent'], { name: 'default' }));
  await waitFor(() => expect(result.current.newKey).toBe('project A'));
  expect(result.current.newValue).toBe('draft A');
  expect(result.current.showForm).toBe(true);
  act(() => client.setQueryData(['current-workspace'], '/other'));
  await waitFor(() => expect(result.current.newKey).toBe('project B'));
});

it('keeps the newer editor when an earlier edit finishes saving', async () => {
  let finish!: () => void;
  mockInvoke('reflect_add_memory', () => new Promise<void>((resolve) => { finish = resolve; }));
  const { result } = setup();
  await waitFor(() => expect(result.current.loading).toBe(false));
  const first = { scope: 'project', key: 'first', value: 'old' };
  const second = { scope: 'project', key: 'second', value: 'other' };
  act(() => result.current.beginEdit(first));
  let save!: Promise<void>;
  act(() => { save = result.current.saveEdit(first); });
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  act(() => { result.current.beginEdit(second); result.current.setEditValue('new input'); });
  await act(async () => { finish(); await save; });
  expect(result.current.editingKey).toBe('project:second');
  expect(result.current.editValue).toBe('new input');
});

it('restores each entry draft when switching between editors', async () => {
  const { result } = setup();
  await waitFor(() => expect(result.current.loading).toBe(false));
  const first = { scope: 'project', key: 'first', value: 'old first' };
  const second = { scope: 'project', key: 'second', value: 'old second' };
  act(() => { result.current.beginEdit(first); result.current.setEditValue('first draft'); });
  act(() => { result.current.beginEdit(second); result.current.setEditValue('second draft'); });
  expect(result.current.savedDrafts).toHaveLength(2);
  act(() => result.current.beginEdit({ ...first, value: 'changed externally' }));
  expect(result.current.editValue).toBe('first draft');
  expect(result.current.editingEntry?.value).toBe('old first');
  act(() => result.current.cancelEdit());
  expect(result.current.savedDrafts).toHaveLength(1);
  act(() => result.current.beginEdit(second));
  expect(result.current.editValue).toBe('second draft');
});

it('keeps an earlier draft when its save fails after switching editors', async () => {
  let fail!: (error: Error) => void;
  mockInvoke('reflect_add_memory', () => new Promise<void>((_resolve, reject) => { fail = reject; }));
  const { result } = setup();
  await waitFor(() => expect(result.current.loading).toBe(false));
  const first = { scope: 'project', key: 'first', value: 'original' };
  const second = { scope: 'project', key: 'second', value: 'other' };
  act(() => { result.current.beginEdit(first); result.current.setEditValue('first draft'); });
  let save!: Promise<void>;
  act(() => { save = result.current.saveEdit(first); });
  await waitFor(() => expect(fail).toBeTypeOf('function'));
  act(() => { result.current.beginEdit(second); result.current.setEditValue('second draft'); });
  await act(async () => { fail(new Error('conflict')); await save; });
  expect(result.current.editValue).toBe('second draft');
  act(() => result.current.beginEdit(first));
  expect(result.current.editValue).toBe('first draft');
});

it('preserves new form input while saving and prevents duplicate submissions', async () => {
  let finish!: () => void;
  const calls: unknown[] = [];
  mockInvoke('reflect_add_memory', (_command, args) => {
    calls.push(args);
    return new Promise<void>((resolve) => { finish = resolve; });
  });
  const { result, client } = setup();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  await waitFor(() => expect(result.current.loading).toBe(false));
  act(() => { result.current.toggleShowForm(); result.current.setNewKey('key'); result.current.setNewValue('first'); });
  let save!: Promise<void>;
  act(() => { save = result.current.addNew(); void result.current.addNew(); });
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  act(() => result.current.setNewValue('later input'));
  await act(async () => { finish(); await save; });
  expect(calls).toEqual([{ scope: 'project', key: 'key', value: 'first', createOnly: true, expectedContext: { workspace: '/workspace', agent: 'default' } }]);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['memory-sections'] });
  expect(result.current.showForm).toBe(true);
  expect(result.current.newValue).toBe('later input');
});

it('uses explicit document mode for legacy whole-file entries', async () => {
  const calls: unknown[] = [];
  mockInvoke('reflect_add_memory', async (_command, args) => { calls.push(args); });
  mockInvoke('reflect_remove_memory', async (_command, args) => { calls.push(args); });
  const { result } = setup();
  await waitFor(() => expect(result.current.loading).toBe(false));
  const entry = { scope: 'project', key: '(all)', value: 'legacy', wholeDocument: true };
  act(() => result.current.beginEdit(entry));
  await act(async () => { await result.current.saveEdit(entry); });
  await act(async () => { await result.current.remove(entry); });
  expect(calls).toEqual([
    { scope: 'project', key: '(all)', value: 'legacy', expectedValue: 'legacy', replaceDocument: true, expectedContext: { workspace: '/workspace', agent: 'default' } },
    { scope: 'project', key: '(all)', expectedValue: 'legacy', replaceDocument: true, expectedContext: { workspace: '/workspace', agent: 'default' } },
  ]);
});
