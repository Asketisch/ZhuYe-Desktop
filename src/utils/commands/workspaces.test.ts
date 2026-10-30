import { expect, it } from 'vitest';
import { mockInvoke } from '@/test/setup';
import { reflect_set_workspace } from './workspaces';

it('applies workspace changes in request order and continues after failure', async () => {
  const calls: string[] = [];
  let finish!: () => void;
  mockInvoke('reflect_set_workspace', async (_command, args) => {
    const path = (args as { path: string }).path;
    calls.push(path);
    if (path === '/first') {
      await new Promise<void>((resolve) => { finish = resolve; });
      throw new Error('switch failed');
    }
  });
  const first = reflect_set_workspace('/first');
  const failure = expect(first).rejects.toThrow('switch failed');
  const second = reflect_set_workspace('/second');
  await Promise.resolve();
  await Promise.resolve();
  expect(calls).toEqual(['/first']);
  finish();
  await failure;
  await expect(second).resolves.toBeUndefined();
  expect(calls).toEqual(['/first', '/second']);
});
