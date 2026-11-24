/**
 * Settings —— 配置加载/保存、权限模式、agent 状态徽标、i18n 切换。
 *
 * 真实应用挂载 + 路由到 /settings，数据流经 fakeBackend 的
 * zhuye_get_config / zhuye_save_config / zhuye_agent_status。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import { renderApp, resetAppAfterEach } from './helpers/appHarness';
import { installFakeBackend, type FakeBackend } from './helpers/fakeBackend';
import { settleConfirm } from '@/logic/modals/confirm';

let backend: FakeBackend;

beforeEach(() => {
  backend = installFakeBackend();
});

afterEach(async () => {
  await resetAppAfterEach();
});

async function openSettings() {
  const app = renderApp();
  await app.navigate('/settings');
  return app;
}

describe('settings status badge', () => {
  it('shows ready state with the configured model', async () => {
    await openSettings();
    await waitFor(() =>
      expect(document.body.textContent).toContain('anthropic/claude-sonnet-4'),
    );
  });

  it('shows degraded state with reason when no model', async () => {
    backend.state.agentStatus = {
      ready: false,
      has_model: false,
      model: null,
      workspace: '/Users/dev/project',
      degraded_reason: 'no API key configured',
    };
    await openSettings();
    await waitFor(() =>
      expect(document.body.textContent).toContain('no API key configured'),
    );
  });

  it('config load failure leaves the settings shell functional (no crash)', async () => {
    backend.state.failures['zhuye_get_config'] = new Error('config parse error');
    await openSettings();
    // 配置区加载失败不阻塞设置页其余功能（状态徽标、权限按钮仍在）。
    await waitFor(() =>
      expect(document.body.textContent).toContain('anthropic/claude-sonnet-4'),
    );
    // 权限快捷控件只在 Permissions 页显示（不再每个设置页签重复）。
    fireEvent.click(screen.getByTestId('settings-section-behavior'));
    const planBtn = await waitFor(() => {
      const btn = screen.getAllByText('Plan', { selector: 'button' })[0];
      expect(btn).toBeDefined();
      return btn as HTMLButtonElement;
    });
    fireEvent.click(planBtn);
    await waitFor(() =>
      expect(backend.lastArgsOf('zhuye_set_permission_mode')).toEqual({ mode: 'plan' }),
    );
  });
});

describe('permission mode controls', () => {
  it('quick buttons dispatch zhuye_set_permission_mode', async () => {
    await openSettings();
    fireEvent.click(screen.getByTestId('settings-section-behavior'));
    const planBtn = await waitFor(() => {
      const btn = screen.getAllByText('Plan', { selector: 'button' })[0];
      expect(btn).toBeDefined();
      return btn as HTMLButtonElement;
    });
    fireEvent.click(planBtn);
    await waitFor(() =>
      expect(backend.lastArgsOf('zhuye_set_permission_mode')).toEqual({ mode: 'plan' }),
    );
  });

  it('permissions section exposes the full-access switch (confirm gate + per-session policy)', async () => {
    const app = await openSettings();
    fireEvent.click(screen.getByTestId('settings-section-behavior'));
    // 完全访问开关：启用先弹确认（pub/sub 模态,直接 settle），确认后落
    // full_access 偏好；关闭重置 auto。不发权限模式命令。
    const onBtn = screen.getByText('Full access', { selector: 'button' });
    fireEvent.click(onBtn);
    await waitFor(() => expect(screen.queryByTestId('settings-page')).toBeDefined());
    act(() => settleConfirm(true));
    await waitFor(() =>
      expect(localStorage.getItem('zhuye.approvalPolicy.new')).toBe('full_access'),
    );
    expect(backend.lastArgsOf('zhuye_set_permission_mode')).toBeUndefined();
    const offBtn = screen.getByText('Off', { selector: 'button' });
    fireEvent.click(offBtn);
    await waitFor(() =>
      expect(localStorage.getItem('zhuye.approvalPolicy.new')).toBe('auto'),
    );
  });
});

describe('config editing & save round-trip', () => {
  it('editing raw TOML and saving persists via zhuye_save_config', async () => {
    const app = await openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));

    const textarea = await screen.findByDisplayValue(
      (v: string) => v.includes('provider = "anthropic"'),
    );
    fireEvent.change(textarea, {
      target: { value: '[active]\nprovider = "openai"\nmodel = "gpt-5"\n' },
    });

    const saveBtn = screen.getByText('Save', { exact: false });
    fireEvent.click(saveBtn);

    await waitFor(() =>
      expect(backend.lastArgsOf('zhuye_save_config')).toEqual({
        toml: '[active]\nprovider = "openai"\nmodel = "gpt-5"\n',
      }),
    );
    // 后端状态持久化，get_config 回读一致。
    expect(backend.state.configToml).toContain('openai');
    // 保存成功后按钮切换为 Saved 反馈。
    await waitFor(() => expect(screen.getByText('Saved', { exact: false })).toBeDefined());
  });

  it('save failure does not show success feedback', async () => {
    backend.state.failures['zhuye_save_config'] = new Error('disk full');
    const app = await openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));

    const saveBtn = await screen.findByText('Save', { exact: false });
    fireEvent.click(saveBtn);

    await waitFor(() => expect(backend.callsOf('zhuye_save_config').length).toBe(1));
    // 失败时不出现 Saved。
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Saved', { exact: false })).toBeNull();
  });
});

describe('settings i18n', () => {
  it('switching language to zh-CN re-renders settings chrome', async () => {
    await openSettings();
    // 语言下拉在「常规」分区（全局偏好，不再是侧栏常驻项）。
    fireEvent.click(screen.getByTestId('settings-section-general'));
    await waitFor(() => expect(document.body.textContent).toContain('General'));

    // Language 下拉无关联 label；页面有多个 combobox，按含 en/zh-CN 选项定位。
    const select = screen
      .getAllByRole('combobox')
      .find((el) => el.querySelector('option[value="zh-CN"]')) as HTMLSelectElement;
    expect(select).toBeDefined();
    fireEvent.change(select, { target: { value: 'zh-CN' } });

    await waitFor(() => expect(document.documentElement.getAttribute('lang')).toBe('zh-CN'));
  });
});
