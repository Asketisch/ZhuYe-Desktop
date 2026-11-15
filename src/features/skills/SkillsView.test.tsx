/**
 * Vitest —— SkillsView 测试(技能面)。
 *
 * 覆盖(v1.11 桌面#1:Skill 市场):
 * - 技能列表照常渲染(fakeBackend / mock 数据)
 * - 市场安装:输入 repo → Install 转发 `reflect_install_skill`
 * - 安装失败:错误 toast 化(store 断言),按钮恢复可点
 * - 空参数禁止提交
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { SkillsView } from './SkillsView';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup';
import { useAgentStore } from '@/stores/agentStore';

function wrap(node: React.ReactNode) {
  return <QueryClientProvider client={createTestQueryClient()}>{node}</QueryClientProvider>;
}

const SKILLS = [
  {
    name: 'code-review',
    description: 'Review code before commit',
    path: '/tmp/skills/code-review/SKILL.md',
    tools: ['read', 'grep'],
    triggers: ['review'],
  },
];

describe('SkillsView — skill marketplace', () => {
  beforeEach(() => {
    resetMockInvoke();
    mockInvoke('reflect_list_skills', async () => SKILLS);
    mockInvoke('reflect_list_tools', async () => []);
    mockInvoke('reflect_rescan_extensions', async () => 'sub-fake');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the marketplace row and the installed skill list', async () => {
    render(wrap(<SkillsView />));
    expect(await screen.findByTestId('skill-market-row')).toBeDefined();
    const row = await screen.findByTestId('skill-row-code-review');
    expect(row.textContent).toContain('code-review');
  });

  it('disables Install on empty input and forwards repo on click', async () => {
    const installCalls: Array<{ repo: string }> = [];
    mockInvoke('reflect_install_skill', async (_cmd: string, args: { repo: string }) => {
      installCalls.push(args);
      return 'sub-fake';
    });
    render(wrap(<SkillsView />));
    await screen.findByTestId('skill-market-row');
    const btn = screen.getByTestId('skill-install-btn') as HTMLButtonElement;
    // 空输入 → 禁止提交。
    expect(btn.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Skill marketplace'), {
      target: { value: 'owner/repo' },
    });
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await vi.waitFor(() => {
      expect(installCalls).toEqual([{ repo: 'owner/repo' }]);
    });
    // 成功 toast 入 store。
    await vi.waitFor(() => {
      const toasts = useAgentStore.getState().toasts;
      expect(toasts.some((t) => t.kind === 'success' && t.message.includes('owner/repo'))).toBe(true);
    });
  });

  it('re-lists skills after a successful install (auto rescan)', async () => {
    // 「装完自动重扫」的 GUI 落点 = 安装成功后 skillsQ.refetch() →
    // reflect_list_skills 被再次调用(装进来的技能立即可见)。
    const listCalls: number[] = [];
    mockInvoke('reflect_list_skills', async () => {
      listCalls.push(Date.now());
      return SKILLS;
    });
    mockInvoke('reflect_install_skill', async () => 'sub-fake');
    render(wrap(<SkillsView />));
    await screen.findByTestId('skill-market-row');
    const before = listCalls.length;
    fireEvent.change(screen.getByLabelText('Skill marketplace'), {
      target: { value: 'owner/new-skill' },
    });
    fireEvent.click(screen.getByTestId('skill-install-btn'));
    await vi.waitFor(() => {
      expect(listCalls.length).toBeGreaterThan(before);
    }, { timeout: 3000 });
  });

  it('toastifies install failures and keeps the button usable', async () => {
    mockInvoke('reflect_install_skill', async () => {
      throw new Error('repo has no SKILL.md');
    });
    render(wrap(<SkillsView />));
    await screen.findByTestId('skill-market-row');
    fireEvent.change(screen.getByLabelText('Skill marketplace'), {
      target: { value: 'bad/repo' },
    });
    fireEvent.click(screen.getByTestId('skill-install-btn'));
    await vi.waitFor(() => {
      const toasts = useAgentStore.getState().toasts;
      expect(toasts.some((t) => t.kind === 'error' && t.message.includes('repo has no SKILL.md'))).toBe(true);
    });
    // 失败后按钮恢复可点(可重试)。
    expect((screen.getByTestId('skill-install-btn') as HTMLButtonElement).disabled).toBe(false);
  });
});
