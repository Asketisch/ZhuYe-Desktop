import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup';
import { AutopilotView } from './AutopilotView';

beforeEach(() => {
  resetMockInvoke();
  mockInvoke('reflect_list_agent_defs', async () => []);
});

function renderView() {
  return render(<QueryClientProvider client={createTestQueryClient()}><AutopilotView /></QueryClientProvider>);
}

it('edits the selected agent and saves it in the autopilot payload', async () => {
  mockInvoke('reflect_get_autopilot_config', async () => ({ enabled: false, schedule: '0 9 * * *', taskTemplate: 'task', agent: null, maxConcurrent: 1 }));
  mockInvoke('reflect_list_agent_defs', async () => [
    { name: 'nightly', description: 'Nightly runner', spawnable: true, readonly: false, tools: [], disallowed_tools: [], model: null, maxTurns: null, memory: [], mcpCollections: [], systemPrompt: '', source: 'custom' },
  ]);
  mockInvoke('reflect_autopilot_history', async () => []);
  const saved: unknown[] = [];
  mockInvoke('reflect_update_autopilot_config', async (_cmd, args) => {
    saved.push(args);
  });

  renderView();
  await screen.findByRole('option', { name: 'nightly' });
  fireEvent.click(screen.getByText('Edit'));
  fireEvent.change(screen.getByLabelText('Agent'), { target: { value: 'nightly' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(saved[0]).toMatchObject({ config: { agent: 'nightly' } });
});

it('does not offer editing when configuration cannot be loaded', async () => {
  mockInvoke('reflect_get_autopilot_config', async () => { throw { msg: 'invalid config' }; });
  mockInvoke('reflect_autopilot_history', async () => []);
  renderView();
  expect(await screen.findByText('Failed to load autopilot configuration.')).toBeDefined();
  expect(screen.queryByText('Edit')).toBeNull();
});

it('explains the background execution state', async () => {
  mockInvoke('reflect_get_autopilot_config', async () => ({ enabled: true, schedule: '* * * * *', taskTemplate: 'task', agent: null, maxConcurrent: 1 }));
  mockInvoke('reflect_autopilot_history', async () => []);
  renderView();
  expect(await screen.findByText('Configured as enabled')).toBeDefined();
  expect(screen.getByText(/A selected agent runs in an isolated side channel\./)).toBeDefined();
});

it('reports history failures instead of showing an empty history', async () => {
  mockInvoke('reflect_get_autopilot_config', async () => ({ enabled: false, schedule: '', taskTemplate: '', agent: null, maxConcurrent: 1 }));
  mockInvoke('reflect_autopilot_history', async () => { throw { msg: 'invalid history' }; });
  renderView();
  expect(await screen.findByText('Failed to load autopilot history.')).toBeDefined();
  expect(screen.queryByText('No runs yet')).toBeNull();
});

it('keeps the draft and reports a failed save', async () => {
  mockInvoke('reflect_get_autopilot_config', async () => ({ enabled: false, schedule: '', taskTemplate: '', agent: null, maxConcurrent: 1 }));
  mockInvoke('reflect_autopilot_history', async () => []);
  mockInvoke('reflect_update_autopilot_config', async () => { throw { msg: 'disk full' }; });
  renderView();
  fireEvent.click(await screen.findByText('Edit'));
  fireEvent.change(screen.getByLabelText('Max concurrent'), { target: { value: '3' } });
  fireEvent.click(screen.getByText('Save'));
  expect(await screen.findByText('Failed to save autopilot configuration.')).toBeDefined();
  expect((screen.getByLabelText('Max concurrent') as HTMLInputElement).value).toBe('3');
});

it('refreshes run history while the view stays open', async () => {
  vi.useFakeTimers();
  try {
    let calls = 0;
    mockInvoke('reflect_get_autopilot_config', async () => ({ enabled: false, schedule: '', taskTemplate: '', agent: null, maxConcurrent: 1 }));
    mockInvoke('reflect_autopilot_history', async () => {
      calls += 1;
      return calls === 1 ? [] : [{ id: 'run-1', executedAtMs: 1_700_000_000_000, status: 'success' }];
    });
    renderView();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(calls).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_100); });
    expect(calls).toBeGreaterThan(1);
    expect(screen.getByText('success')).toBeDefined();
  } finally {
    vi.useRealTimers();
  }
});
