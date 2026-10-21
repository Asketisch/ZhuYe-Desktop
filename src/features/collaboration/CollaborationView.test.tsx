/**
 * Vitest — CollaborationView 多智能体编排区(discussion / pipeline)测试。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { CollaborationView } from '@/features/collaboration/CollaborationView';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup.tsx';

function wrap(node: React.ReactNode) {
  return <QueryClientProvider client={createTestQueryClient()}>{node}</QueryClientProvider>;
}

describe('CollaborationView — orchestration', () => {
  beforeEach(() => {
    resetMockInvoke();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders discussion history from reflect_list_discussions', async () => {
    mockInvoke('reflect_list_discussions', async () => [
      {
        sessionId: '11111111-2222-3333-4444-555555555555',
        title: 'demo-session',
        model: 'test-model',
        startedAt: '2026-01-01T00:00:00Z',
        messageCount: 4,
      },
    ]);
    render(wrap(<CollaborationView />));
    expect(await screen.findByTestId('discussion-section')).toBeDefined();
    expect(await screen.findByText('demo-session')).toBeDefined();
  });

  it('runs a discussion from a picked TOML config and shows the transcript', async () => {
    mockInvoke('reflect_list_teams', async () => []);
    mockInvoke('reflect_list_discussions', async () => []);
    mockInvoke('reflect_pick_file', async () => '/Users/dev/discussion.toml');
    const runDiscussion = vi.fn(async () => ({
      discussionId: '99999999-8888-7777-6666-555555555555',
      participants: ['advocate', 'skeptic'],
      transcript: '=== Discussion Transcript ===\n[advocate] hello',
      result: { consensus: false, rounds: 1 },
      llmBacked: false,
    }));
    mockInvoke('reflect_run_discussion', runDiscussion);

    render(wrap(<CollaborationView />));
    fireEvent.click(await screen.findByText(/Choose config/i));
    const pathEl = await screen.findByTestId('discussion-config-path');
    expect((pathEl.textContent ?? '')).toContain('discussion.toml');

    fireEvent.click(screen.getByTestId('discussion-run'));
    expect(await screen.findByTestId('discussion-transcript')).toBeDefined();
    expect(runDiscussion).toHaveBeenCalledTimes(1);
  });

  it('runs a team pipeline and renders the node report', async () => {
    mockInvoke('reflect_list_teams', async () => [
      {
        name: 'rocket',
        description: null,
        lead_agent_id: 'team-lead@rocket',
        members: [],
        created_at: 0,
      },
    ]);
    const runPipeline = vi.fn(async () => ({
      topic: 'ship it',
      status: 'success',
      failure_policy: 'abort',
      nodes: [
        { name: 'plan', status: 'Success', outputs: {}, elapsed_ms: 3, started_at_ms: 0 },
        { name: 'verify', status: 'Failed', outputs: {}, error: 'boom', elapsed_ms: 1, started_at_ms: 2 },
      ],
      total_elapsed_ms: 4,
    }));
    mockInvoke('reflect_run_team_pipeline', runPipeline);

    render(wrap(<CollaborationView />));
    // teams 查询异步解析 —— 等选项真正出现再触发 change(否则 select 无
    // 匹配 option,赋值被 jsdom 重置回空)。
    const rocketOption = await screen.findByRole('option', { name: 'rocket' });
    const teamSelect = rocketOption.closest('select');
    expect(teamSelect).not.toBeNull();
    fireEvent.change(teamSelect as Element, { target: { value: 'rocket' } });
    fireEvent.change(screen.getByTestId('pipeline-topic'), { target: { value: 'ship it' } });
    fireEvent.click(screen.getByTestId('pipeline-run'));

    const report = await screen.findByTestId('pipeline-report');
    expect(report.textContent).toContain('success');
    expect(report.textContent).toContain('plan');
    expect(report.textContent).toContain('boom');
    // mock 挂在 invoke 层 —— 断言线上负载形状(teamName / topic camelCase 键)。
    expect(runPipeline).toHaveBeenCalledWith('reflect_run_team_pipeline', {
      teamName: 'rocket',
      topic: 'ship it',
    });
  });
});
