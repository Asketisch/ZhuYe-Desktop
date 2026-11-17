/**
 * Settings —— 配置加载/保存、权限模式、agent 状态徽标、i18n 切换。
 *
 * 真实应用挂载 + 路由到 /settings，数据流经 fakeBackend 的
 * reflect_get_config / reflect_save_config / reflect_agent_status。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderApp, resetAppAfterEach } from './helpers/appHarness';
import { installFakeBackend, type FakeBackend } from './helpers/fakeBackend';

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
    backend.state.failures['reflect_get_config'] = new Error('config parse error');
    await openSettings();
    // 配置区加载失败不阻塞设置页其余功能（状态徽标、权限按钮仍在）。
    await waitFor(() =>
      expect(document.body.textContent).toContain('anthropic/claude-sonnet-4'),
    );
    // 权限快捷控件只在 Permissions 页显示（不再每个设置页签重复）。
    fireEvent.click(screen.getByText('Permissions'));
    const planBtn = await waitFor(() => {
      const btn = screen.getByText('plan', { selector: 'button' });
      expect(btn).toBeDefined();
      return btn as HTMLButtonElement;
    });
    fireEvent.click(planBtn);
    await waitFor(() =>
      expect(backend.lastArgsOf('reflect_set_permission_mode')).toEqual({ mode: 'plan' }),
    );
  });
});

describe('permission mode controls', () => {
  it('quick buttons dispatch reflect_set_permission_mode', async () => {
    await openSettings();
    fireEvent.click(screen.getByText('Permissions'));
    const planBtn = await waitFor(() => {
      const btn = screen.getByText('plan', { selector: 'button' });
      expect(btn).toBeDefined();
      return btn as HTMLButtonElement;
    });
    fireEvent.click(planBtn);
    await waitFor(() =>
      expect(backend.lastArgsOf('reflect_set_permission_mode')).toEqual({ mode: 'plan' }),
    );
  });

  it('permissions section exposes independent approval policies', async () => {
    const app = await openSettings();
    fireEvent.click(screen.getByText('Permissions'));
    const select = screen.getByRole('combobox', { name: 'Approval' }) as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual(['prompt', 'auto_approve', 'full_access']);
    fireEvent.change(select, { target: { value: 'full_access' } });
    expect(select.value).toBe('full_access');
    expect(backend.lastArgsOf('reflect_set_permission_mode')).toBeUndefined();
  });
});

describe('config editing & save round-trip', () => {
  it('editing raw TOML and saving persists via reflect_save_config', async () => {
    const app = await openSettings();
    fireEvent.click(screen.getByText('Advanced'));

    const textarea = await screen.findByDisplayValue(
      (v: string) => v.includes('provider = "anthropic"'),
    );
    fireEvent.change(textarea, {
      target: { value: '[active]\nprovider = "openai"\nmodel = "gpt-5"\n' },
    });

    const saveBtn = screen.getByText('Save', { exact: false });
    fireEvent.click(saveBtn);

    await waitFor(() =>
      expect(backend.lastArgsOf('reflect_save_config')).toEqual({
        toml: '[active]\nprovider = "openai"\nmodel = "gpt-5"\n',
      }),
    );
    // 后端状态持久化，get_config 回读一致。
    expect(backend.state.configToml).toContain('openai');
    // 保存成功后按钮切换为 Saved 反馈。
    await waitFor(() => expect(screen.getByText('Saved', { exact: false })).toBeDefined());
  });

  it('save failure does not show success feedback', async () => {
    backend.state.failures['reflect_save_config'] = new Error('disk full');
    const app = await openSettings();
    fireEvent.click(screen.getByText('Advanced'));

    const saveBtn = await screen.findByText('Save', { exact: false });
    fireEvent.click(saveBtn);

    await waitFor(() => expect(backend.callsOf('reflect_save_config').length).toBe(1));
    // 失败时不出现 Saved。
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Saved', { exact: false })).toBeNull();
  });
});

describe('settings i18n', () => {
  it('switching language to zh-CN re-renders settings chrome', async () => {
    await openSettings();
    // 语言下拉在 Provider 页（默认页）；顺带断言该页 chrome 已渲染。
    await waitFor(() => expect(document.body.textContent).toContain('Configuration fields'));

    // Language 下拉无关联 label；页面有多个 combobox，按含 en/zh-CN 选项定位。
    const select = screen
      .getAllByRole('combobox')
      .find((el) => el.querySelector('option[value="zh-CN"]')) as HTMLSelectElement;
    expect(select).toBeDefined();
    fireEvent.change(select, { target: { value: 'zh-CN' } });

    await waitFor(() => expect(document.documentElement.getAttribute('lang')).toBe('zh-CN'));
  });
});
