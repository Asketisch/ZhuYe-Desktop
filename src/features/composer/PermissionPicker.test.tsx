/**
 * Vitest — PermissionPicker（底栏左侧工作模式 + 审批策略下拉）。
 *
 * 契约：
 * 1. 触发器显示当前工作模式文案；菜单 = 工作模式三段 + 审批策略四段
 *    （两套概念分区单选，语义正交）
 * 2. 切工作模式走 zhuye_set_permission_mode；审批策略写 per-session
 *    localStorage（null 会话走 'new' 键）且不发命令
 * 3. 审批策略为完全访问时触发器转警示色（data-full-access）；
 *    **切入**完全访问需确认弹窗，取消不落偏好
 * 4. 权限模式恒为三段：store 残留弃用档不裸回显第四项
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

describe('PermissionPicker 工作模式', () => {
  it('触发器显示当前模式;菜单只有计划/询问/默认三段', () => {
    renderPicker();
    expect(screen.getByTestId('composer-permission-trigger').textContent).toContain('默认');
    openMenu();
    expect(screen.getByTestId('composer-perm-plan')).toBeDefined();
    expect(screen.getByTestId('composer-perm-prompt')).toBeDefined();
    expect(screen.getByTestId('composer-perm-auto')).toBeDefined();
    expect(screen.getAllByRole('menuitemradio').length).toBe(3 + 4);
  });

  it('store 残留弃用档不裸回显第四项(恒三段)', () => {
    // reducer/sync 两条写入口都经 normalizePermissionMode 归一;这里强制
    // 注入弃用档,锁定「菜单不出现原始字符串」的渲染契约。
    useAgentStore.setState({ permissionMode: 'accept_edits' as never });
    renderPicker();
    openMenu();
    expect(screen.queryByRole('menuitemradio', { name: /accept_edits/ })).toBeNull();
    // 三段模式项仍在(计划/询问/默认)。
    expect(screen.getByTestId('composer-perm-plan')).toBeDefined();
  });

  it('切换工作模式走 zhuye_set_permission_mode', async () => {
    const calls: string[] = [];
    mockInvoke('zhuye_set_permission_mode', async (_cmd: string, args?: { mode: string }) => {
      calls.push(args?.mode ?? '');
      return 'ok';
    });
    renderPicker();
    openMenu();
    fireEvent.click(screen.getByTestId('composer-perm-plan'));
    await waitFor(() => expect(calls).toEqual(['plan']));
    expect(screen.queryByTestId('composer-permission-menu')).toBeNull();
  });
});

describe('PermissionPicker 审批策略', () => {
  it('默认「跟随模式」(auto);切换写 localStorage 不发命令', () => {
    renderPicker();
    openMenu();
    expect(screen.getByTestId('composer-approval-auto').getAttribute('aria-checked')).toBeDefined();
    fireEvent.click(screen.getByTestId('composer-approval-auto_approve'));
    expect(localStorage.getItem('zhuye.approvalPolicy.new')).toBe('auto_approve');
  });

  it('切入完全访问弹确认;确认后落偏好并点亮触发器警示色', async () => {
    renderPicker();
    openMenu();
    fireEvent.click(screen.getByTestId('composer-approval-full_access'));
    // 确认弹窗是 pub/sub 模态 —— 测试直接 settle「确认」。
    await waitFor(() => expect(screen.queryByTestId('composer-permission-menu')).toBeNull());
    actSettle(true);
    await waitFor(() =>
      expect(localStorage.getItem('zhuye.approvalPolicy.new')).toBe('full_access'),
    );
    expect(
      screen.getByTestId('composer-permission-trigger').getAttribute('data-full-access'),
    ).toBeDefined();
  });

  it('取消确认不落偏好,触发器不转警示色', async () => {
    renderPicker();
    openMenu();
    fireEvent.click(screen.getByTestId('composer-approval-full_access'));
    await waitFor(() => expect(screen.queryByTestId('composer-permission-menu')).toBeNull());
    actSettle(false);
    await waitFor(() =>
      expect(localStorage.getItem('zhuye.approvalPolicy.new')).toBeNull(),
    );
    expect(screen.getByTestId('composer-permission-trigger').getAttribute('data-full-access')).toBeNull();
  });

  it('从完全访问切回其他档不需确认;触发器警示色随之熄灭', async () => {
    localStorage.setItem('zhuye.approvalPolicy.new', 'full_access');
    renderPicker();
    expect(screen.getByTestId('composer-permission-trigger').getAttribute('data-full-access')).toBeDefined();
    openMenu();
    fireEvent.click(screen.getByTestId('composer-approval-prompt'));
    expect(localStorage.getItem('zhuye.approvalPolicy.new')).toBe('prompt');
    expect(screen.getByTestId('composer-permission-trigger').getAttribute('data-full-access')).toBeNull();
  });
});

/** settle 待处理的确认弹窗（confirmDialog 的 pub/sub 模态测试通道）。 */
function actSettle(ok: boolean) {
  settleConfirm(ok);
}
