/**
 * SettingsHost —— 设置页宿主测试。
 *
 * 回归背景：设置页曾经历过「内容列被窄栏挤没」的塌陷回归；现为全屏
 * 两栏覆盖层（`.page` 固定铺满窗口）。本测试既钉住「壳结构 + 分区导航
 * 可见」，也钉住 CSS 契约（两栏栅格 + 固定铺满）—— 只断言 DOM 挡不住
 * 样式回归。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@/utils/i18n';
import { SettingsHost } from '@/features/shell/SettingsHost';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup.tsx';

const PAGE_CSS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../src/render/settings/SettingsPage.module.css',
);

function renderHost() {
  return render(
    <I18nProvider>
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsHost open onClose={() => {}} />
      </QueryClientProvider>
    </I18nProvider>,
  );
}

describe('SettingsHost · 设置页宿主', () => {
  beforeEach(() => {
    resetMockInvoke();
    localStorage.clear();
    mockInvoke('zhuye_get_config', async () => '[active]\nprovider = "anthropic"\n');
    mockInvoke('zhuye_agent_status', async () => ({
      has_model: true,
      model: 'anthropic/claude-sonnet-4',
      provider: 'anthropic',
    }));
    mockInvoke('zhuye_get_user_instructions', async () => '');
    mockInvoke('zhuye_save_user_instructions', async () => undefined);
  });
  afterEach(() => cleanup());

  it('打开时渲染全屏壳与设置内容', async () => {
    renderHost();
    expect(screen.getByTestId('settings-page')).toBeTruthy();
    // 内容区存在（塌陷回归时分区标题不可见）。
    await waitFor(() => {
      expect(screen.getByTestId('settings-page').textContent).toContain('Model settings');
    });
  });

  it('分组导航包含全部要求分区', async () => {
    renderHost();
    const page = screen.getByTestId('settings-page');
    await waitFor(() => {
      for (const label of [
        'General', 'Appearance', 'Model settings', 'Remote devices',
        'Personalization', 'Behavior and tools', 'Memory', 'Subagents',
        'Plugins', 'MCP Servers', 'Skills', 'Hooks', 'Usage stats', 'Advanced',
      ]) {
        expect(page.textContent, `缺少分区:${label}`).toContain(label);
      }
    });
    // 分组标题（三组）。
    for (const group of ['Basics', 'Agent capabilities', 'Data and statistics']) {
      expect(page.textContent, `缺少分组:${group}`).toContain(group);
    }
  });

  it('点击分区导航切换内容区', async () => {
    renderHost();
    await waitFor(() => screen.getByTestId('settings-section-appearance'));
    fireEvent.click(screen.getByTestId('settings-section-appearance'));
    await waitFor(() => {
      expect(screen.getByTestId('settings-page').getAttribute('data-active-section')).toBe('appearance');
    });
    fireEvent.click(screen.getByTestId('settings-section-personalization'));
    await waitFor(() => {
      expect(screen.getByTestId('settings-page').getAttribute('data-active-section')).toBe('personalization');
    });
  });

  it('Esc 关闭设置页', () => {
    const onClose = vi.fn();
    render(
      <I18nProvider>
        <QueryClientProvider client={createTestQueryClient()}>
          <SettingsHost open onClose={onClose} />
        </QueryClientProvider>
      </I18nProvider>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('CSS 契约：.page 是固定铺满的两栏栅格（268px + 1fr）', () => {
    const css = readFileSync(PAGE_CSS, 'utf8');
    const rule = css.match(/\.page\s*\{([^}]*)\}/);
    expect(rule, 'SettingsPage.module.css 缺 .page 规则').toBeTruthy();
    const body = rule?.[1] ?? '';
    expect(body).toMatch(/position:\s*fixed/);
    expect(body).toMatch(/inset:\s*0/);
    const columns = body.match(/grid-template-columns\s*:\s*([^;]+);/);
    expect(columns, '.page 缺 grid-template-columns 声明').toBeTruthy();
    expect(columns?.[1]).toContain('268px');
  });
});
