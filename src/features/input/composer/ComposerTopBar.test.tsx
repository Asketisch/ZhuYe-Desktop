/**
 * Vitest — ComposerTopBar（输入卡顶栏：工作区 / 分支 / worktree 开关）。
 *
 * 覆盖：
 * 1. 工作区胶囊显示 basename；菜单列出已知工作区，切换走
 *    zhuye_set_workspace 并失效相关查询
 * 2. 分支胶囊显示分支 + ↑↓；非 repo 时隐藏；菜单列出本地分支，
 *    点击切换走 zhuye_git_checkout；脏树走「提交后重试」
 *    （stage → checkpoint commit → checkout）
 * 3. worktree 开关：非 repo 隐藏；勾选写 agentStore.worktreeIntent，
 *    分支胶囊原位替换为起点分支选择器；已在隔离 worktree 时转只读指示
 * 4. 运行位置：默认本地，有远端会话时显示主机名
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@/utils/i18n';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup';
import { useAgentStore } from '@/stores/agentStore';
import { settleConfirm } from '@/logic/harness/modals/confirm';
import { ComposerTopBar } from './ComposerTopBar';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/chat' }),
}));

/** 每个 renderTopBar 创建独立 QueryClient（用例间查询缓存互不污染）。 */
let lastClient: ReturnType<typeof createTestQueryClient>;

function renderTopBar() {
  lastClient = createTestQueryClient();
  return render(
    <I18nProvider>
      <QueryClientProvider client={lastClient}>
        <ComposerTopBar />
      </QueryClientProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  // 断言锚定中文文案 —— 显式锁定 locale,不随环境 navigator.language 漂移。
  localStorage.setItem('zhuye.locale', 'zh-CN');
  resetMockInvoke();
  useAgentStore.setState({ worktreeIntent: null, loadedSessionId: 'sess-1' });
  mockInvoke('zhuye_current_workspace', async () => '/Users/me/Code/alpha');
  mockInvoke('zhuye_git_status', async () => ({
    branch: 'main', upstream: 'origin/main', ahead: 1, behind: 2,
    entries: [], raw: '', is_repo: true,
  }));
  mockInvoke('zhuye_list_worktrees', async () => []);
  mockInvoke('zhuye_remote_sessions', async () => []);
  mockInvoke('zhuye_list_workspaces', async () => [
    { path: '/Users/me/Code/alpha', label: 'alpha', last_used: 1, session_count: 2 },
    { path: '/Users/me/Code/beta', label: '', last_used: 2, session_count: 0 },
  ]);
  mockInvoke('zhuye_git_branches', async () => [
    { name: 'main', current: true },
    { name: 'feature', current: false },
  ]);
});

describe('顶栏静态展示', () => {
  it('工作区胶囊显示 basename;分支胶囊显示分支与 ↑↓;仓库内显示 worktree 开关', async () => {
    renderTopBar();
    // 工作区查询异步回流 —— 等 basename 出现再断言(胶囊先于数据渲染)。
    const ws = await screen.findByTestId('composer-workspace-pill');
    await waitFor(() => expect(ws.textContent).toContain('alpha'));
    const branch = await screen.findByTestId('composer-branch-pill');
    expect(branch.textContent).toContain('main');
    expect(branch.textContent).toContain('↑1');
    expect(branch.textContent).toContain('↓2');
    expect(screen.getByTestId('composer-worktree-toggle')).toBeDefined();
  });

  it('非 repo:分支胶囊与 worktree 开关都不渲染,工作区胶囊保留', async () => {
    mockInvoke('zhuye_git_status', async () => ({
      branch: null, upstream: null, ahead: 0, behind: 0, entries: [], raw: '', is_repo: false,
    }));
    renderTopBar();
    expect(await screen.findByTestId('composer-workspace-pill')).toBeDefined();
    await waitFor(() =>
      expect(screen.queryByTestId('composer-branch-pill')).toBeNull(),
    );
    expect(screen.queryByTestId('composer-worktree-toggle')).toBeNull();
  });

  it('运行位置:默认本地', async () => {
    renderTopBar();
    await waitFor(() =>
      expect(screen.getByTestId('composer-runtime-pill').textContent).toContain('本地'),
    );
  });

  it('有远端会话时运行位置显示主机名', async () => {
    mockInvoke('zhuye_remote_sessions', async () => [
      { sid: 's1', host: 'dev-box', cwd: '/w', isForeground: true },
    ]);
    renderTopBar();
    await waitFor(() =>
      expect(screen.getByTestId('composer-runtime-pill').textContent).toContain('dev-box'),
    );
  });
});

describe('工作区菜单', () => {
  it('菜单列出已知工作区,点击切换走 zhuye_set_workspace 并失效查询', async () => {
    renderTopBar();
    fireEvent.click(await screen.findByTestId('composer-workspace-pill'));
    const list = await screen.findByTestId('composer-workspace-list');
    expect(list.textContent).toContain('alpha');
    expect(list.textContent).toContain('beta');

    const invalidated: string[] = [];
    const invalidateSpy = vi.spyOn(lastClient, 'invalidateQueries');
    invalidateSpy.mockImplementation(((arg: { queryKey: string[] }) => {
      invalidated.push(arg.queryKey.join('|'));
      return Promise.resolve();
    }) as never);

    mockInvoke('zhuye_set_workspace', async () => undefined);
    // beta 项没有 label → 回退 basename。
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'beta' }));
    await waitFor(() => expect(invalidated).toContain('current-workspace'));
    invalidateSpy.mockRestore();
  });

  it('当前工作区项打勾且点击不重复切换', async () => {
    const calls: string[] = [];
    mockInvoke('zhuye_set_workspace', async (_cmd: string, args?: { path: string }) => {
      calls.push(args?.path ?? '');
    });
    renderTopBar();
    fireEvent.click(await screen.findByTestId('composer-workspace-pill'));
    const alpha = await screen.findByRole('menuitemradio', { name: 'alpha' });
    expect(alpha.getAttribute('aria-checked')).toBeDefined();
    fireEvent.click(alpha);
    expect(calls).toEqual([]);
  });
});

describe('分支菜单与切换', () => {
  it('菜单列出本地分支,当前项打勾;点击其他分支走 checkout', async () => {
    const calls: string[] = [];
    mockInvoke('zhuye_git_checkout', async (_cmd: string, args?: { branch: string }) => {
      calls.push(args?.branch ?? '');
    });
    renderTopBar();
    fireEvent.click(await screen.findByTestId('composer-branch-pill'));
    const list = await screen.findByTestId('composer-branch-list');
    expect(list.textContent).toContain('feature');

    const feature = screen.getByRole('menuitemradio', { name: /feature/ });
    expect(feature.getAttribute('aria-checked')).toBeNull();
    fireEvent.click(feature);
    await waitFor(() => expect(calls).toEqual(['feature']));
  });

  it('当前分支项显示脏文件数;点击当前分支不重复切换', async () => {
    mockInvoke('zhuye_git_status', async () => ({
      branch: 'main', upstream: null, ahead: 0, behind: 0,
      entries: [{ path: 'a', status: 'M', staged: false, old_path: null }],
      raw: '', is_repo: true,
    }));
    const calls: string[] = [];
    mockInvoke('zhuye_git_checkout', async (_cmd: string, args?: { branch: string }) => {
      calls.push(args?.branch ?? '');
    });
    renderTopBar();
    fireEvent.click(await screen.findByTestId('composer-branch-pill'));
    const main = await screen.findByRole('menuitemradio', { name: /main/ });
    expect(main.textContent).toContain('1');
    fireEvent.click(main);
    expect(calls).toEqual([]);
  });

  it('脏树「提交后重试」:确认后 stage → checkpoint commit → checkout', async () => {
    mockInvoke('zhuye_git_status', async () => ({
      branch: 'main', upstream: null, ahead: 0, behind: 0,
      entries: [
        { path: 'a', status: 'M', staged: false, old_path: null },
        { path: 'b', status: '??', staged: false, old_path: null },
      ],
      raw: '', is_repo: true,
    }));
    const calls: string[] = [];
    mockInvoke('zhuye_git_stage', async () => { calls.push('stage'); });
    mockInvoke('zhuye_git_commit', async (_cmd: string, args?: { message: string }) => {
      calls.push(`commit:${args?.message ?? ''}`);
      return 'abc1234';
    });
    mockInvoke('zhuye_git_checkout', async (_cmd: string, args?: { branch: string }) => {
      calls.push(`checkout:${args?.branch ?? ''}`);
    });
    renderTopBar();
    fireEvent.click(await screen.findByTestId('composer-branch-pill'));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /feature/ }));
    // 确认弹窗 settle 为「提交并切换」。
    settleConfirm(true);
    await waitFor(() =>
      expect(calls).toEqual([
        'stage',
        'commit:chore: checkpoint before switching to feature',
        'checkout:feature',
      ]),
    );
  });
});

describe('worktree 隔离开关', () => {
  it('勾选写 worktreeIntent,分支胶囊原位替换为起点分支选择器;取消恢复', async () => {
    renderTopBar();
    const toggle = await screen.findByTestId('composer-worktree-toggle');
    fireEvent.click(toggle.querySelector('input') as HTMLInputElement);
    await waitFor(() =>
      expect(useAgentStore.getState().worktreeIntent).toEqual({ ref: null }),
    );
    // 分支胶囊被替换;起点分支选择器默认选「当前 HEAD」。
    expect(screen.queryByTestId('composer-branch-pill')).toBeNull();
    fireEvent.click(await screen.findByTestId('composer-startref-pill'));
    const head = await screen.findByRole('menuitemradio', { name: /当前 HEAD/ });
    expect(head.getAttribute('aria-checked')).toBeDefined();

    // 选 feature 为起点 → intent.ref 更新。
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^feature$/ }));
    await waitFor(() =>
      expect(useAgentStore.getState().worktreeIntent).toEqual({ ref: 'feature' }),
    );

    // 取消勾选清空意图,分支胶囊恢复。
    fireEvent.click(screen.getByTestId('composer-worktree-toggle').querySelector('input') as HTMLInputElement);
    await waitFor(() => expect(useAgentStore.getState().worktreeIntent).toBeNull());
    await waitFor(() => expect(screen.getByTestId('composer-branch-pill')).toBeDefined());
  });

  it('当前会话已在隔离 worktree:开关转只读指示态且勾选', async () => {
    mockInvoke('zhuye_list_worktrees', async () => [
      { path: '/Users/me/Code/alpha', branch: 'main', head: 'h', dirty: false, isolated: false, stranded: false },
      { path: '/tmp/proj-worktrees/wt-1', branch: 'wt-1', head: 'h', dirty: false, isolated: true, stranded: false },
    ]);
    mockInvoke('zhuye_current_workspace', async () => '/tmp/proj-worktrees/wt-1');
    renderTopBar();
    await waitFor(() => {
      const toggle = screen.getByTestId('composer-worktree-toggle');
      expect(toggle.getAttribute('data-static')).toBeDefined();
    });
    const input = screen.getByTestId('composer-worktree-toggle').querySelector('input') as HTMLInputElement;
    expect(input.checked).toBe(true);
    expect(input.disabled).toBe(true);
  });
});
