/**
 * Vitest — ComposerControls 控制行的提示词预设下拉。
 *
 * 契约:入口只在「最初创建会话」窗口(turns 为空)显示,会话开始后锁定
 * (缓存命中语义);选项 = 跟随默认 + 智能匹配 + prompt_list 回流的可用层;
 * 选择写入 per-session localStorage(null 会话走 'new' 键,创建后转正);
 * bind 恢复在 ChatBinding(syncSessionPromptSelection),这里只管选择。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@/utils/i18n';
import { createTestQueryClient } from '@/test/setup.tsx';
import { useAgentStore } from '@/stores/agentStore';
import { ComposerControls } from './ComposerControls';

vi.mock('@/utils/commands/permissions', async () => {
  const actual = await vi.importActual<typeof import('@/utils/commands/permissions')>('@/utils/commands/permissions');
  return {
    ...actual,
    zhuye_get_effort: vi.fn().mockResolvedValue('low'),
    zhuye_set_effort: vi.fn().mockResolvedValue(null),
  };
});

function renderControls() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <I18nProvider><ComposerControls /></I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  useAgentStore.setState({ turns: [], loadedSessionId: null, prompt: null });
});

describe('ComposerControls 提示词预设下拉', () => {
  it('空会话(turns 为空)显示下拉,含跟随默认与智能匹配两项', () => {
    renderControls();
    const select = screen.getByTestId('composer-prompt-select') as HTMLSelectElement;
    const values = [...select.options].map((o) => o.value);
    expect(values).toContain('default');
    expect(values).toContain('auto');
    expect(select.value).toBe('default');
  });

  it('available 层回流后作为手动项出现(不含 default 层)', () => {
    useAgentStore.setState({ prompt: {
      available: ['default', 'gpt', 'claude', 'qwen'], currentSpec: 'openai/gpt-x',
      activeLayers: [], profile: 'default', switchedAt: null,
    } });
    renderControls();
    const select = screen.getByTestId('composer-prompt-select') as HTMLSelectElement;
    const values = [...select.options].map((o) => o.value);
    expect(values).toEqual(['default', 'auto', 'gpt', 'claude', 'qwen']);
  });

  it('prompt 状态未回流(null)时挂载触发一次 promptList 拉取', async () => {
    const list = vi.fn(async () => {});
    useAgentStore.setState({ promptList: list as unknown as () => Promise<void> });
    renderControls();
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  });

  it('会话有内容(turns 非空)后入口隐藏 —— 缓存命中锁定语义', () => {
    useAgentStore.setState({ turns: [{ id: 't1' } as never] });
    renderControls();
    expect(screen.queryByTestId('composer-prompt-select')).toBeNull();
  });

  it('选择 manual 层写入 per-session localStorage;null 会话走 new 键', () => {
    useAgentStore.setState({ prompt: {
      available: ['default', 'gpt'], currentSpec: 'openai/gpt-x',
      activeLayers: [], profile: 'default', switchedAt: null,
    } });
    renderControls();
    fireEvent.change(screen.getByTestId('composer-prompt-select'), { target: { value: 'gpt' } });
    expect(localStorage.getItem('zhuye.promptSelection.new'))
      .toBe(JSON.stringify({ mode: 'manual', profile: 'gpt' }));
  });

  it('bind 恢复的会话选择经 sessionId 回显(非 null 会话读正式键)', () => {
    localStorage.setItem('zhuye.promptSelection.sess-9', JSON.stringify({ mode: 'auto' }));
    useAgentStore.setState({ loadedSessionId: 'sess-9' });
    renderControls();
    expect((screen.getByTestId('composer-prompt-select') as HTMLSelectElement).value).toBe('auto');
  });
});
