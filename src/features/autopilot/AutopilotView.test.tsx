import { beforeEach, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup';
import { AutopilotView } from './AutopilotView';

beforeEach(() => resetMockInvoke());

function renderView() {
  return render(<QueryClientProvider client={createTestQueryClient()}><AutopilotView /></QueryClientProvider>);
}

it('does not offer editing when configuration cannot be loaded', async () => {
  mockInvoke('reflect_get_autopilot_config', async () => { throw { msg: 'invalid config' }; });
  mockInvoke('reflect_autopilot_history', async () => []);
  renderView();
  expect(await screen.findByText('Failed to load autopilot configuration.')).toBeDefined();
  expect(screen.queryByText('Edit')).toBeNull();
});

it('explains that an enabled configuration does not run tasks', async () => {
  mockInvoke('reflect_get_autopilot_config', async () => ({ enabled: true, schedule: '* * * * *', taskTemplate: 'task', agent: null, maxConcurrent: 1 }));
  mockInvoke('reflect_autopilot_history', async () => []);
  renderView();
  expect(await screen.findByText('Configured as enabled')).toBeDefined();
  expect(screen.getByText('Automatic task execution is not available yet. These settings are saved but do not start scheduled tasks.')).toBeDefined();
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
