import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup';
import { WorkspacesView } from './WorkspacesView';

afterEach(() => { cleanup(); resetMockInvoke(); });

it('shows history read errors instead of an empty list', async () => {
  mockInvoke('reflect_list_workspaces', async () => { throw new Error('history is corrupt'); });
  render(<QueryClientProvider client={createTestQueryClient()}><WorkspacesView /></QueryClientProvider>);
  expect(await screen.findByText('Failed to load recent workspaces')).toBeDefined();
  expect(screen.getByText('history is corrupt')).toBeDefined();
});
