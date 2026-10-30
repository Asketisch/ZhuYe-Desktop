/**
 * Vitest —— MemoryView（B11-01）。
 *
 * 冒烟测试：渲染空状态 + 验证过滤器/表单存在。
 * 真实 CRUD 在集成测试中针对 Tauri 后端执行。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryView } from './MemoryView';
import { createTestQueryClient, mockInvoke } from '@/test/setup.tsx';
import { useMemoryDraftStore } from './memoryDraftStore';

// 模拟后端调用
vi.mock('@/utils/commands', async () => {
  const actual = await vi.importActual<typeof import('@/utils/commands')>('@/utils/commands');
  return {
    ...actual,
    reflect_list_memory: async () => [],
    reflect_add_memory: async () => {},
    reflect_remove_memory: async () => {},
  };
});

function wrap(node: React.ReactNode) {
  return <QueryClientProvider client={createTestQueryClient()}>{node}</QueryClientProvider>;
}

describe('MemoryView', () => {
  beforeEach(() => {
    cleanup();
    useMemoryDraftStore.setState({ editSessions: {}, formDrafts: {} });
    mockInvoke('reflect_current_workspace', async () => '/workspace');
    mockInvoke('reflect_get_active_agent', async () => ({ name: 'default', memoryScopes: [] }));
  });

  it('renders the page title', () => {
    render(wrap(<MemoryView />));
    expect(screen.getByText('Memory')).toBeDefined();
  });

  it('renders scope filter buttons', () => {
    render(wrap(<MemoryView />));
    expect(screen.getByTestId('memory-filter-all')).toBeDefined();
    expect(screen.getByTestId('memory-filter-user')).toBeDefined();
    expect(screen.getByTestId('memory-filter-project')).toBeDefined();
  });

  it('renders the add button', () => {
    render(wrap(<MemoryView />));
    expect(screen.getByTestId('memory-add-btn')).toBeDefined();
  });

  it('shows add form when toggled', async () => {
    render(wrap(<MemoryView />));
    const btn = screen.getByTestId('memory-add-btn');
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    expect(screen.getByTestId('memory-new-key')).toBeDefined();
    expect(screen.getByTestId('memory-new-value')).toBeDefined();
  });

  it('displays empty state when no memory entries', async () => {
    render(wrap(<MemoryView />));
    // useQuery 异步触发 —— 等待空文本出现
    const el = await screen.findByText(/No memory entries/i, {}, { timeout: 3000 });
    expect(el).toBeDefined();
  });

  it('refreshes sections for the current workspace and describes the budget accurately', async () => {
    mockInvoke('reflect_get_active_agent', async () => ({ name: 'default', memoryScopes: ['project'], injectBudgetChars: 8000 }));
    mockInvoke('reflect_memory_sections', async (_command, args) => {
      const workspace = (args?.expectedContext as { workspace: string }).workspace;
      return [{ scope: 'project', title: workspace, body: 'text', index: 0, chars: 4 }];
    });
    const client = createTestQueryClient();
    render(<QueryClientProvider client={client}><MemoryView /></QueryClientProvider>);
    expect(await screen.findByText('project · /workspace')).toBeDefined();
    expect(screen.getByText(/4 stored body characters; injection budget 8,000/)).toBeDefined();
    act(() => client.setQueryData(['current-workspace'], '/another'));
    await waitFor(() => expect(screen.getByText('project · /another')).toBeDefined());
    expect(screen.queryByText('project · /workspace')).toBeNull();
  });

  it('warns when an agent enables only one persistent scope', async () => {
    mockInvoke('reflect_get_active_agent', async () => ({ name: 'default', memoryScopes: ['project'], injectBudgetChars: 8000 }));
    render(wrap(<MemoryView />));
    expect((await screen.findByTestId('memory-scope-warning')).textContent).toContain('does not enable User memory');
  });

  it('warns when only session memory is enabled', async () => {
    mockInvoke('reflect_get_active_agent', async () => ({ name: 'default', memoryScopes: ['session'], injectBudgetChars: 8000 }));
    render(wrap(<MemoryView />));
    expect((await screen.findByTestId('memory-scope-warning')).textContent).toContain('does not enable Project, User memory');
  });

  it('reports a section loading failure', async () => {
    mockInvoke('reflect_memory_sections', async () => { throw new Error('unavailable'); });
    render(wrap(<MemoryView />));
    expect(await screen.findByText('Failed to load memory sections.')).toBeDefined();
  });

  it('keeps an edit visible when its original entry disappears', async () => {
    useMemoryDraftStore.setState({ editSessions: {
      [JSON.stringify(['/workspace', 'default'])]: { activeKey: 'project:removed', drafts: {
        'project:removed': { entry: { scope: 'project', key: 'removed', value: 'old' }, value: 'unsaved text', revision: 1 },
      } },
    } });
    render(wrap(<MemoryView />));
    expect(await screen.findByTestId('memory-orphan-draft')).toBeDefined();
    expect((screen.getByTestId('memory-edit-input') as HTMLTextAreaElement).value).toBe('unsaved text');
  });

  it('allows resuming or discarding inactive drafts for deleted entries', async () => {
    useMemoryDraftStore.setState({ editSessions: {
      [JSON.stringify(['/workspace', 'default'])]: { activeKey: 'project:one', drafts: {
        'project:one': { entry: { scope: 'project', key: 'one', value: 'old' }, value: 'draft one', revision: 1 },
        'project:two': { entry: { scope: 'project', key: 'two', value: 'old' }, value: 'draft two', revision: 2 },
      } },
    } });
    render(wrap(<MemoryView />));
    const orphan = await screen.findByTestId('memory-orphan-draft');
    fireEvent.click(within(within(orphan).getByTestId('memory-entry-two')).getByTitle('Resume draft'));
    expect((screen.getByTestId('memory-edit-input') as HTMLTextAreaElement).value).toBe('draft two');
    fireEvent.click(within(within(orphan).getByTestId('memory-entry-one')).getByTitle('Discard draft'));
    expect(within(orphan).queryByTestId('memory-entry-one')).toBeNull();
  });
});
