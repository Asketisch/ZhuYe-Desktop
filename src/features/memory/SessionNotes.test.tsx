import { beforeEach, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup';
import { useAgentStore } from '@/stores/agentStore';
import { SessionNotes } from './SessionNotes';

beforeEach(() => {
  resetMockInvoke();
  useAgentStore.getState().reset();
  useAgentStore.setState({ loadedSessionId: 'current-session' });
  mockInvoke('reflect_list_note_sessions', async () => [{ sessionId: 'other-session', count: 1 }]);
  mockInvoke('reflect_list_session_notes', async (_command, args) => [{ text: `notes for ${args?.id}`, createdAt: '2020-01-01T00:00:00Z' }]);
});

function renderNotes() {
  return render(<QueryClientProvider client={createTestQueryClient()}><SessionNotes /></QueryClientProvider>);
}

it('can select the only historical session and return to the current session', async () => {
  renderNotes();
  expect(await screen.findByText('notes for current-session')).toBeDefined();
  const picker = await screen.findByTestId('notes-session-picker') as HTMLSelectElement;
  expect(picker.value).toBe('');
  fireEvent.change(picker, { target: { value: 'other-session' } });
  expect(await screen.findByText('notes for other-session')).toBeDefined();
  fireEvent.change(picker, { target: { value: '' } });
  await waitFor(() => expect(screen.getByText('notes for current-session')).toBeDefined());
});

it('reports session-list failures and serialized note errors', async () => {
  mockInvoke('reflect_list_note_sessions', async () => { throw { msg: 'directory unavailable' }; });
  mockInvoke('reflect_list_session_notes', async () => { throw { msg: 'file unavailable' }; });
  renderNotes();
  expect(await screen.findByText('Failed to load note sessions.')).toBeDefined();
  expect(await screen.findByText('file unavailable')).toBeDefined();
});
