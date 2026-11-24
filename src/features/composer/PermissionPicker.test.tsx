/**
 * Vitest — PermissionPicker（底栏左侧权限三档下拉，ZCode 同款）。
 *
 * 契约：
 * 1. 菜单只有三档单选项：询问(prompt) / 自主模式(auto) / 完全访问(full_access)；
 *    计划不在菜单 —— 会话处于计划模式时三档都不勾选，顶部显示计划态提示行。
 * 2. 选中态派生：审批策略 = full_access → 完全访问；否则按 permissionMode
 *    （prompt/auto）；plan 三档全不选。
 * 3. 模式档切换走 zhuye_set_permission_mode + 写工作模式偏好，并把审批
 *    策略重置回 auto（三档互斥）；完全访问写 per-session localStorage，
 *    **切入**需确认弹窗，取消不落偏好；从完全访问切回其他档不需确认。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@/utils/i18n';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup.tsx';
import { useAgentStore } from '@/stores/agentStore';
import { settleConfirm } from '@/logic/modals/confirm';
import { PermissionPicker } from './PermissionPicker';

function renderPicker() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <I18nProvider><PermissionPicker /></I18nProvider>
    </QueryClientProvider>,
  );
}

/** 打开菜单（触发器点击）。 */
function openMenu() {
  fireEvent.click(screen.getByTestId('composer-permission-trigger'));
  return screen.getByTestId('composer-permission-menu');
}

beforeEach(() => {
  localStorage.clear();
  // 断言锚定中文文案 —— 显式锁定 locale,不随环境 navigator.language 漂移。
  localStorage.setItem('zhuye.locale', 'zh-CN');
  resetMockInvoke();
  useAgentStore.setState({ turns: [], loadedSessionId: null, permissionMode: 'auto' });
});

describe('PermissionPicker 三档模型', () => {
  it('默认(自主模式)触发器;菜单只有询问/自主模式/完全访问三档', () => {
    renderPicker();
    expect(screen.getByTestId('composer-permission-trigger').textContent).toContain('自主模式');
    openMenu();
    expect(screen.getByTestId('composer-perm-prompt')).toBeDefined();
    expect(screen.getByTestId('composer-perm-auto')).toBeDefined();
    expect(screen.getByTestId('composer-perm-full_access')).toBeDefined();
    // 计划不在菜单。
    expect(screen.queryByTestId('composer-perm-plan')).toBeNull();
    expect(screen.getAllByRole('menuitemradio').length).toBe(3);
    // 默认档(auto)有勾选。
    expect(screen.getByTestId('composer-perm-auto').getAttribute('aria-checked')).toBeDefined();
  });

  it('会话处于计划模式:三档不勾选,顶部显示计划态提示行', () => {
    useAgentStore.setState({ permissionMode: 'plan' });
    renderPicker();
    expect(screen.getByTestId('composer-permission-trigger').textContent).toContain('计划');
    const menu = openMenu();
    expect(screen.getByTestId('composer-perm-plan-hint')).toBeDefined();
    expect(screen.getByTestId('composer-perm-prompt').getAttribute('aria-checked')).toBeNull();
    expect(screen.getByTestId('composer-perm-auto').getAttribute('aria-checked')).toBeNull();
    expect(screen.getByTestId('composer-perm-full_access').getAttribute('aria-checked')).toBeNull();
    expect(menu.textContent).toContain('计划模式');
  });

  it('切模式档走 zhuye_set_permission_mode + 写偏好,并把审批策略重置回 auto', async () => {
    const calls: string[] = [];
    mockInvoke('zhuye_set_permission_mode', async (_cmd: string, args?: { mode: string }) => {
      calls.push(args?.mode ?? '');
      return 'ok';
    });
    // 预置完全访问：切模式档后必须被重置。
    localStorage.setItem('zhuye.approvalPolicy.new', 'full_access');
    renderPicker();
    openMenu();
    fireEvent.click(screen.getByTestId('composer-perm-prompt'));
    await waitFor(() => expect(calls).toEqual(['prompt']));
    expect(localStorage.getItem('zhuye.permissionMode.new')).toBe('prompt');
    expect(localStorage.getItem('zhuye.approvalPolicy.new')).toBe('auto');
    expect(screen.queryByTestId('composer-permission-menu')).toBeNull();
  });

  it('store 残留弃用档不裸回显(派生回落为无选中)', () => {
    // reducer/sync 两条写入口都经 normalizePermissionMode 归一;这里强制
    // 注入弃用档,锁定「菜单不出现原始字符串」的渲染契约。
    useAgentStore.setState({ permissionMode: 'accept_edits' as never });
    renderPicker();
    const menu = openMenu();
    expect(screen.queryByRole('menuitemradio', { name: /accept_edits/ })).toBeNull();
    expect(screen.queryByTestId('composer-perm-plan-hint')).toBeNull();
    expect(menu.textContent).not.toContain('accept_edits');
  });
});

describe('PermissionPicker 完全访问', () => {
  it('切入完全访问弹确认;确认后落偏好并点亮触发器警示色', async () => {
    renderPicker();
    openMenu();
    fireEvent.click(screen.getByTestId('composer-perm-full_access'));
    // 确认弹窗是 pub/sub 模态 —— 测试直接 settle「确认」。
    await waitFor(() => expect(screen.queryByTestId('composer-permission-menu')).toBeNull());
    act(() => settleConfirm(true));
    await waitFor(() =>
      expect(localStorage.getItem('zhuye.approvalPolicy.new')).toBe('full_access'),
    );
    expect(
      screen.getByTestId('composer-permission-trigger').getAttribute('data-full-access'),
    ).toBeDefined();
    expect(screen.getByTestId('composer-permission-trigger').textContent).toContain('完全访问');
  });

  it('取消确认不落偏好,触发器不转警示色', async () => {
    renderPicker();
    openMenu();
    fireEvent.click(screen.getByTestId('composer-perm-full_access'));
    await waitFor(() => expect(screen.queryByTestId('composer-permission-menu')).toBeNull());
    act(() => settleConfirm(false));
    await waitFor(() =>
      expect(localStorage.getItem('zhuye.approvalPolicy.new')).toBeNull(),
    );
    expect(screen.getByTestId('composer-permission-trigger').getAttribute('data-full-access')).toBeNull();
  });

  it('从完全访问切回其他档不需确认;审批策略重置且警示色熄灭', async () => {
    mockInvoke('zhuye_set_permission_mode', async () => 'sub-1');
    localStorage.setItem('zhuye.approvalPolicy.new', 'full_access');
    renderPicker();
    expect(screen.getByTestId('composer-permission-trigger').getAttribute('data-full-access')).toBeDefined();
    openMenu();
    fireEvent.click(screen.getByTestId('composer-perm-auto'));
    expect(localStorage.getItem('zhuye.approvalPolicy.new')).toBe('auto');
    expect(screen.getByTestId('composer-permission-trigger').getAttribute('data-full-access')).toBeNull();
    // 等 setPermissionMode 的异步回执 flush，避免未处理拒绝泄漏到下一用例。
    await act(async () => { await Promise.resolve(); });
  });
});
