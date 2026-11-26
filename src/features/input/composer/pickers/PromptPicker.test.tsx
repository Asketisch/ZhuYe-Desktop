/**
 * Vitest — PromptPicker(底栏左侧提示词预设 pill,权限按钮右边)。
 *
 * 契约:入口只在「最初创建会话」窗口(turns 为空)显示,会话开始后
 * 整个 pill 消失(缓存命中语义);v1.7 两级菜单 —— 一级工具名、二级
 * 模型变体,单变体组渲染为叶项,顶部固定跟随默认/智能匹配;旧引擎
 * 无 groups 时平铺回退,有 groups 时平铺清单滤掉已覆盖项(变体 id +
 * 家族层)仅剩自建层;选择写入 per-session localStorage(null 会话走
 * 'new' 键,创建后转正);bind 恢复在 ChatBinding,这里只管选择与回显。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@/utils/i18n';
import { createTestQueryClient, resetMockInvoke } from '@/test/setup.tsx';
import { useAgentStore } from '@/stores/agentStore';
import type { PromptGroup } from '@/utils/commands/knowledge/prompts';
import { PromptPicker } from './PromptPicker';

function renderPicker() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <I18nProvider><PromptPicker /></I18nProvider>
    </QueryClientProvider>,
  );
}

/** 打开弹出菜单(pill 是 button 触发器,先 click)。 */
function openMenu() {
  fireEvent.click(screen.getByTestId('composer-prompt-select'));
  return screen.getByTestId('composer-prompt-menu');
}

function setPromptState(available: string[], groups?: PromptGroup[]) {
  useAgentStore.setState({ prompt: {
    available, currentSpec: 'openai/gpt-x',
    activeLayers: [], profile: 'default', switchedAt: null, groups,
  } });
}

const GROUPS: PromptGroup[] = [
  {
    id: 'claude-code',
    label: 'claude-code',
    familyLayer: 'claude',
    variants: [
      { id: 'claude-code-opus-4.6', label: 'Opus 4.6' },
      { id: 'claude-code-sonnet-5.5', label: 'Sonnet 5.5' },
    ],
  },
  { id: 'glm', label: 'GLM', familyLayer: 'glm', variants: [{ id: 'glm', label: 'GLM' }] },
];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('zhuye.locale', 'zh-CN');
  resetMockInvoke();
  useAgentStore.setState({ turns: [], loadedSessionId: null, prompt: null });
});

describe('PromptPicker 提示词预设 pill', () => {
  it('空会话(turns 为空)显示 pill,菜单含跟随默认与智能匹配两项', () => {
    setPromptState(['default', 'gpt']);
    renderPicker();
    fireEvent.click(screen.getByTestId('composer-prompt-select'));
    expect(screen.getByTestId('composer-prompt-default')).toBeTruthy();
    expect(screen.getByTestId('composer-prompt-auto')).toBeTruthy();
  });

  it('两级菜单:多变体组渲染一级项并展开二级模型清单', () => {
    setPromptState(['default', 'claude', 'claude-code-opus-4.6', 'claude-code-sonnet-5.5'], GROUPS);
    renderPicker();
    openMenu();
    // 多变体组:一级项 + 二级子菜单(点击展开)。
    fireEvent.click(screen.getByTestId('composer-prompt-group-claude-code'));
    const submenu = screen.getByTestId('composer-prompt-submenu-claude-code');
    expect(submenu.textContent).toContain('Opus 4.6');
    expect(submenu.textContent).toContain('Sonnet 5.5');
    // 单变体组渲染为一级叶项,点击即选中。
    expect(screen.getByTestId('composer-prompt-leaf-glm')).toBeTruthy();
  });

  it('groups 存在时平铺清单滤掉已覆盖项(变体 id + 家族层),自建层保留', () => {
    setPromptState(
      ['default', 'claude', 'claude-code-opus-4.6', 'claude-code-sonnet-5.5', 'glm', 'my-custom'],
      GROUPS,
    );
    renderPicker();
    openMenu();
    // 家族层 `claude` 与变体 id 不再重复出现。
    expect(screen.queryByRole('menuitem', { name: 'claude' })).toBeNull();
    // 自建层保留为额外叶项。
    expect(screen.getByRole('menuitem', { name: 'my-custom' })).toBeTruthy();
  });

  it('旧引擎无 groups:平铺回退(v1.6.1 行为)', () => {
    setPromptState(['default', 'gpt', 'claude']);
    renderPicker();
    openMenu();
    expect(screen.getByRole('menuitem', { name: 'gpt' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'claude' })).toBeTruthy();
    expect(screen.queryByTestId('composer-prompt-group-claude-code')).toBeNull();
  });

  it('点选叶项写入 per-session localStorage;null 会话走 new 键', () => {
    setPromptState(['default'], GROUPS);
    renderPicker();
    openMenu();
    fireEvent.click(screen.getByTestId('composer-prompt-leaf-glm'));
    expect(localStorage.getItem('zhuye.promptSelection.new'))
      .toBe(JSON.stringify({ mode: 'manual', profile: 'glm' }));
  });

  it('点选二级变体写入变体 id 并回显目录显示名', () => {
    setPromptState(['default'], GROUPS);
    renderPicker();
    openMenu();
    fireEvent.click(screen.getByTestId('composer-prompt-group-claude-code'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Opus 4.6' }));
    expect(localStorage.getItem('zhuye.promptSelection.new'))
      .toBe(JSON.stringify({ mode: 'manual', profile: 'claude-code-opus-4.6' }));
    // 回显:目录显示名 + 菜单已关闭。
    expect((screen.getByTestId('composer-prompt-select') as HTMLButtonElement).textContent).toBe('Opus 4.6');
    expect(screen.queryByTestId('composer-prompt-menu')).toBeNull();
  });

  it('bind 恢复的会话选择经 sessionId 回显(auto → 智能匹配模型)', () => {
    localStorage.setItem('zhuye.promptSelection.sess-9', JSON.stringify({ mode: 'auto' }));
    useAgentStore.setState({ loadedSessionId: 'sess-9' });
    renderPicker();
    expect(
      (screen.getByTestId('composer-prompt-select') as HTMLButtonElement).textContent,
    ).toBe('智能匹配模型');
  });

  it('prompt 状态未回流(null)时挂载触发一次 promptList 拉取', async () => {
    const list = vi.fn(async () => {});
    useAgentStore.setState({ promptList: list as unknown as () => Promise<void> });
    renderPicker();
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  });

  it('会话有内容(turns 非空)后整个 pill 消失 —— 缓存命中锁定语义', () => {
    useAgentStore.setState({ turns: [{ id: 't1' } as never] });
    renderPicker();
    expect(screen.queryByTestId('composer-prompt-picker')).toBeNull();
    expect(screen.queryByTestId('composer-prompt-select')).toBeNull();
  });
});
