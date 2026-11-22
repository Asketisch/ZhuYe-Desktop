/**
 * Vitest — ComposerPlusMenu「+」入口菜单。
 *
 * 覆盖：
 * 1. 默认收起，点击「+」展开菜单
 * 2. 附件 → 打开文件选择器
 * 3. 斜杠命令 / @ 文件引用 → 调用对应回调（原底栏图标按钮收编进菜单）
 * 4. 压缩 → 立即执行 slash 命令
 * 5. 目标 / 计划 → 把命令填进输入框（由用户补参数）
 * 6. 技能 / 插件 → 二级子菜单列出条目
 * 7. 提示词预设 → 仅空会话显示；选项写入 per-session localStorage
 *    （null 会话走 'new' 键，创建后转正；bind 恢复在 ChatBinding）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@/utils/i18n';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup.tsx';
import { useAgentStore } from '@/stores/agentStore';
import { ComposerPlusMenu } from './ComposerPlusMenu';

function renderMenu(props: Partial<React.ComponentProps<typeof ComposerPlusMenu>> = {}) {
  const handlers = {
    onAttachFile: vi.fn(),
    onRunSlash: vi.fn(),
    onFillSlash: vi.fn(),
    onInsertText: vi.fn(),
    onOpenSlash: vi.fn(),
    onMention: vi.fn(),
    ...props,
  };
  render(
    <I18nProvider>
      <QueryClientProvider client={createTestQueryClient()}>
        <ComposerPlusMenu {...handlers} />
      </QueryClientProvider>
    </I18nProvider>,
  );
  return handlers;
}

beforeEach(() => {
  resetMockInvoke();
  localStorage.clear();
  localStorage.setItem('zhuye.locale', 'zh-CN');
  useAgentStore.setState({ turns: [], loadedSessionId: null, prompt: null });
  mockInvoke('zhuye_list_skills', async () => [
    { name: 'demo-skill', description: '示例技能', path: '/s', tools: [], triggers: [] },
  ]);
  mockInvoke('zhuye_list_plugin_commands', async () => [
    { name: 'demo:hello', description: '插件命令' },
  ]);
});

describe('ComposerPlusMenu 基础动作', () => {
  it('默认收起，点击「+」展开菜单', () => {
    renderMenu();
    expect(screen.queryByTestId('composer-plus-menu')).toBeNull();
    fireEvent.click(screen.getByTestId('composer-plus'));
    expect(screen.getByTestId('composer-plus-menu')).toBeDefined();
    expect(screen.getByTestId('composer-plus-attach')).toBeDefined();
    expect(screen.getByTestId('composer-plus-slash')).toBeDefined();
    expect(screen.getByTestId('composer-plus-mention')).toBeDefined();
    expect(screen.getByTestId('composer-plus-compact')).toBeDefined();
    expect(screen.getByTestId('composer-plus-goal')).toBeDefined();
    expect(screen.getByTestId('composer-plus-plan')).toBeDefined();
  });

  it('附件入口打开文件选择器', () => {
    const handlers = renderMenu();
    fireEvent.click(screen.getByTestId('composer-plus'));
    fireEvent.click(screen.getByTestId('composer-plus-attach'));
    expect(handlers.onAttachFile).toHaveBeenCalled();
    expect(screen.queryByTestId('composer-plus-menu')).toBeNull();
  });

  it('斜杠命令与 @ 引用入口调用对应回调（原底栏按钮收编进菜单）', () => {
    const handlers = renderMenu();
    fireEvent.click(screen.getByTestId('composer-plus'));
    fireEvent.click(screen.getByTestId('composer-plus-slash'));
    expect(handlers.onOpenSlash).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('composer-plus'));
    fireEvent.click(screen.getByTestId('composer-plus-mention'));
    expect(handlers.onMention).toHaveBeenCalledTimes(1);
  });

  it('压缩立即执行 slash 命令', () => {
    const handlers = renderMenu();
    fireEvent.click(screen.getByTestId('composer-plus'));
    fireEvent.click(screen.getByTestId('composer-plus-compact'));
    expect(handlers.onRunSlash).toHaveBeenCalledWith('compact');
  });

  it('目标与计划把命令填进输入框（由用户补参数）', () => {
    const handlers = renderMenu();
    fireEvent.click(screen.getByTestId('composer-plus'));
    fireEvent.click(screen.getByTestId('composer-plus-goal'));
    expect(handlers.onFillSlash).toHaveBeenCalledWith('goal');
    fireEvent.click(screen.getByTestId('composer-plus'));
    fireEvent.click(screen.getByTestId('composer-plus-plan'));
    expect(handlers.onFillSlash).toHaveBeenCalledWith('plan');
    expect(handlers.onRunSlash).not.toHaveBeenCalled();
  });

  it('技能与插件是二级子菜单', async () => {
    renderMenu();
    fireEvent.click(screen.getByTestId('composer-plus'));
    fireEvent.click(screen.getByTestId('composer-plus-skills'));
    // 技能清单是异步查询 —— 等条目出现再断言。
    await waitFor(() =>
      expect(screen.getByTestId('composer-plus-skills-list').textContent).toContain('demo-skill'),
    );

    fireEvent.click(screen.getByTestId('composer-plus-plugins'));
    await waitFor(() =>
      expect(screen.getByTestId('composer-plus-plugins-list').textContent).toContain('demo:hello'),
    );
  });
});

describe('ComposerPlusMenu 提示词预设（仅空会话）', () => {
  it('空会话(turns 为空)显示入口,子菜单含跟随默认与智能匹配', async () => {
    renderMenu();
    fireEvent.click(screen.getByTestId('composer-plus'));
    fireEvent.click(screen.getByTestId('composer-plus-prompts'));
    const list = screen.getByTestId('composer-plus-prompts-list');
    expect(list.textContent).toContain('跟随默认');
    expect(list.textContent).toContain('智能匹配模型');
  });

  it('available 层回流后作为手动项出现(不含 default 层)', async () => {
    useAgentStore.setState({ prompt: {
      available: ['default', 'gpt', 'claude', 'qwen'], currentSpec: 'openai/gpt-x',
      activeLayers: [], profile: 'default', switchedAt: null,
    } });
    renderMenu();
    fireEvent.click(screen.getByTestId('composer-plus'));
    fireEvent.click(screen.getByTestId('composer-plus-prompts'));
    await waitFor(() => {
      const text = screen.getByTestId('composer-plus-prompts-list').textContent;
      expect(text).toContain('gpt');
      expect(text).toContain('claude');
      expect(text).toContain('qwen');
    });
  });

  it('prompt 状态未回流(null)时挂载触发一次 promptList 拉取', async () => {
    const list = vi.fn(async () => {});
    useAgentStore.setState({ promptList: list as unknown as () => Promise<void> });
    renderMenu();
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  });

  it('会话有内容(turns 非空)后入口隐藏 —— 缓存命中锁定语义', () => {
    useAgentStore.setState({ turns: [{ id: 't1' } as never] });
    renderMenu();
    fireEvent.click(screen.getByTestId('composer-plus'));
    expect(screen.queryByTestId('composer-plus-prompts')).toBeNull();
  });

  it('选择 manual 层写入 per-session localStorage;null 会话走 new 键', async () => {
    useAgentStore.setState({ prompt: {
      available: ['default', 'gpt'], currentSpec: 'openai/gpt-x',
      activeLayers: [], profile: 'default', switchedAt: null,
    } });
    renderMenu();
    fireEvent.click(screen.getByTestId('composer-plus'));
    fireEvent.click(screen.getByTestId('composer-plus-prompts'));
    // 子菜单里点 gpt 层项（button 文本即层名）。
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'gpt' }));
    expect(localStorage.getItem('zhuye.promptSelection.new'))
      .toBe(JSON.stringify({ mode: 'manual', profile: 'gpt' }));
  });

  it('bind 恢复的会话选择经 sessionId 回显(非 null 会话读正式键)', () => {
    localStorage.setItem('zhuye.promptSelection.sess-9', JSON.stringify({ mode: 'auto' }));
    useAgentStore.setState({ loadedSessionId: 'sess-9' });
    renderMenu();
    fireEvent.click(screen.getByTestId('composer-plus'));
    fireEvent.click(screen.getByTestId('composer-plus-prompts'));
    const auto = screen.getByRole('menuitemradio', { name: '智能匹配模型' });
    expect(auto.getAttribute('aria-checked')).toBeDefined();
  });
});
