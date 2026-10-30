import { expect, it, vi } from 'vitest';
import { mockInvoke } from '@/test/setup';
import { reflect_bind_session } from '@/utils/commands/sessions';
import { reflect_set_workspace } from '@/utils/commands/workspaces';

it('serializes backend binds and continues after a failure', async () => {
  const calls: string[] = [];
  let finish!: () => void;
  mockInvoke('reflect_bind_session', async (_command, args) => {
    const id = (args as { id: string }).id;
    calls.push(id);
    if (id === 'first') {
      await new Promise<void>((resolve) => { finish = resolve; });
      throw new Error('bind failed');
    }
    return 'auto';
  });
  const first = reflect_bind_session('first');
  const failure = expect(first).rejects.toThrow('bind failed');
  const second = reflect_bind_session('second');
  await vi.waitFor(() => expect(calls).toEqual(['first']));
  finish();
  await failure;
  await expect(second).resolves.toBe('auto');
  expect(calls).toEqual(['first', 'second']);
});

it('waits for queued workspace switches before binding', async () => {
  const calls: string[] = [];
  let finish!: () => void;
  mockInvoke('reflect_set_workspace', async () => {
    calls.push('switch');
    await new Promise<void>((resolve) => { finish = resolve; });
  });
  mockInvoke('reflect_bind_session', async () => { calls.push('bind'); return 'auto'; });
  const switching = reflect_set_workspace('/project');
  const binding = reflect_bind_session('session');
  await Promise.resolve();
  await Promise.resolve();
  expect(calls).toEqual(['switch']);
  finish();
  await switching;
  await expect(binding).resolves.toBe('auto');
  expect(calls).toEqual(['switch', 'bind']);
});
