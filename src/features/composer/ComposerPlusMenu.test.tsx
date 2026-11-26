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
import { ComposerPlusMenu } from './ComposerPlusMenu';

function renderMenu(props: Partial<React.ComponentProps<typeof ComposerPlusMenu>> = {}) {
  const handlers = {
    onAttachFile: vi.fn(),
    onRunSlash: vi.fn(),
    onFillSlash: vi.fn(),
    onInsertText: vi.fn(),
    onOpenSlash: vi.fn(),
    onMention: vi.fn(),
    onPrefill: vi.fn(),
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

  it('「建议」是二级子目录，按分组列出四个任务模板', () => {
    renderMenu();
    fireEvent.click(screen.getByTestId('composer-plus'));
    fireEvent.click(screen.getByTestId('composer-plus-suggestions'));
    const list = screen.getByTestId('composer-plus-suggestions-list');
    expect(list.textContent).toContain('探索并理解代码');
    expect(list.textContent).toContain('构建新功能');
    expect(list.textContent).toContain('审查代码改动');
    expect(list.textContent).toContain('修复问题');
    // 分组标题（先读懂 / 再动手）。
    expect(list.textContent).toContain('先读懂');
    expect(list.textContent).toContain('再动手');
  });

  it('点模板条目 → 预填对应 prompt 并关闭菜单（不自动发送）', () => {
    const handlers = renderMenu();
    fireEvent.click(screen.getByTestId('composer-plus'));
    fireEvent.click(screen.getByTestId('composer-plus-suggestions'));
    fireEvent.click(screen.getByTestId('composer-plus-suggestion-explore'));
    const prefill = handlers.onPrefill as ReturnType<typeof vi.fn>;
    expect(prefill).toHaveBeenCalledTimes(1);
    expect(String(prefill.mock.calls[0][0])).toContain('探索这个代码库');
    expect(screen.queryByTestId('composer-plus-menu')).toBeNull();
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
