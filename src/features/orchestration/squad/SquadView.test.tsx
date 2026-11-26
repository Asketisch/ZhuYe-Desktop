/**
 * Vitest — SquadView 测试。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { SquadView } from '@/features/orchestration/squad';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup.tsx';

function wrap(node: React.ReactNode) {
  return <QueryClientProvider client={createTestQueryClient()}>{node}</QueryClientProvider>;
}

describe('SquadView', () => {
  beforeEach(() => {
    resetMockInvoke();
    mockInvoke('zhuye_list_squads', async () => []);
    mockInvoke('zhuye_list_tasks', async () => []);
  });
  afterEach(() => cleanup());

  it('renders empty state when no squads', async () => {
    render(wrap(<SquadView />));
    expect(await screen.findByText(/No squads yet/i)).toBeDefined();
    expect(screen.getByText(/Create squad/i)).toBeDefined();
  });

  it('create form exposes name + member add + create button', () => {
    render(wrap(<SquadView />));
    expect(screen.getByTestId('squad-name')).toBeDefined();
    expect(screen.getByTestId('member-add')).toBeDefined();
    expect(screen.getByTestId('squad-create')).toBeDefined();
  });

  it('renders squad rows from the API', async () => {
    mockInvoke('zhuye_list_squads', async () => [
      {
        name: 'rocket',
        description: 'go fast',
        leaderActor: {
          actorType: 'agent',
          actorId: 'team-lead@rocket',
          kind: 'lead',
          displayName: 'Lead',
          teamName: 'rocket',
        },
        members: [],
        createdAtMs: 1,
      },
    ]);

    render(wrap(<SquadView />));
    expect(await screen.findByText('rocket')).toBeDefined();
    expect(screen.getByTestId('squad-rocket')).toBeDefined();
  });
});
