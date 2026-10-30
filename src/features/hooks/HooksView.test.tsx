import { beforeEach, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup';
import { useAgentStore } from '@/stores/agentStore';
import { HooksView } from './HooksView';

beforeEach(() => {
  resetMockInvoke();
  useAgentStore.getState().reset();
});

function renderHooks() {
  return render(<QueryClientProvider client={createTestQueryClient()}><HooksView /></QueryClientProvider>);
}

it('serializes toggles and refreshes the actual backend state', async () => {
  let enabled = true;
  let finish!: () => void;
  let calls = 0;
  mockInvoke('reflect_list_hooks', async () => [
    { name: 'one', kind: 'builtin', enabled, config_summary: '' },
    { name: 'two', kind: 'builtin', enabled: true, config_summary: '' },
  ]);
  mockInvoke('reflect_toggle_hook', () => {
    calls += 1;
    return new Promise<void>((resolve) => { finish = () => { enabled = false; resolve(); }; });
  });
  renderHooks();
  const first = await screen.findByTestId('hook-toggle-one') as HTMLInputElement;
  fireEvent.click(first);
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  expect((screen.getByTestId('hook-toggle-two') as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByTestId('hook-toggle-two'));
  expect(calls).toBe(1);
  finish();
  await waitFor(() => expect((screen.getByTestId('hook-toggle-one') as HTMLInputElement).checked).toBe(false));
});

it('displays serialized backend errors without changing the toggle', async () => {
  mockInvoke('reflect_list_hooks', async () => [{ name: 'one', kind: 'builtin', enabled: true, config_summary: '' }]);
  mockInvoke('reflect_toggle_hook', async () => { throw { msg: 'write failed' }; });
  renderHooks();
  fireEvent.click(await screen.findByTestId('hook-toggle-one'));
  await waitFor(() => expect(useAgentStore.getState().toasts.at(-1)?.message).toBe('write failed'));
  expect((screen.getByTestId('hook-toggle-one') as HTMLInputElement).checked).toBe(true);
});

it('labels notification-only events instead of offering ineffective decisions', async () => {
  mockInvoke('reflect_list_hooks', async () => []);
  mockInvoke('reflect_list_hook_events', async () => [{ kind: 'task_created', description: 'Task created', decisions: [] }]);
  renderHooks();
  fireEvent.click(screen.getByTestId('hooks-events-toggle'));
  expect(await screen.findByText('Notification only')).toBeDefined();
});
