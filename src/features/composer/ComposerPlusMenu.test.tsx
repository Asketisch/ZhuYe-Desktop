/**
 * Vitest — ComposerPlusMenu「+」入口菜单（zcode 式）。
 *
 * 覆盖：
 * 1. 默认收起，点击「+」展开菜单
 * 2. 附件 → 打开文件选择器
 * 3. 压缩 → 立即执行 slash 命令
 * 4. 目标 / 计划 → 把命令填进输入框（由用户补参数）
 * 5. 技能 / 插件 → 二级子菜单列出条目
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

describe('ComposerPlusMenu', () => {
  beforeEach(() => {
    resetMockInvoke();
    mockInvoke('zhuye_list_skills', async () => [
      { name: 'demo-skill', description: '示例技能', path: '/s', tools: [], triggers: [] },
    ]);
    mockInvoke('zhuye_list_plugin_commands', async () => [
      { name: 'demo:hello', description: '插件命令' },
    ]);
  });

  it('默认收起，点击「+」展开菜单', () => {
    renderMenu();
    expect(screen.queryByTestId('composer-plus-menu')).toBeNull();
    fireEvent.click(screen.getByTestId('composer-plus'));
    expect(screen.getByTestId('composer-plus-menu')).toBeDefined();
    expect(screen.getByTestId('composer-plus-attach')).toBeDefined();
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
