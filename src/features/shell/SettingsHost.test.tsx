/**
 * SettingsHost —— harness 设置弹窗测试。
 *
 * 回归背景：v3 把设置从路由页改成模态，但 `harness.css` 的 `.modal`
 * 仍是「200px 侧栏 + 内容」双列栅格，而 SettingsHost 只渲染了
 * `.ms-main`（没有 `.ms-side`）—— `.ms-main` 落进 200px 窄列，内层
 * SettingsView 的 200px 侧栏吃光宽度，内容列塌成 0，**提供商 / 模型组 /
 * 权限等分区全部不可见**。
 *
 * 本测试既钉住「弹窗结构上是单列、内容区存在」，也钉住 CSS 契约
 * （`.modal` 不得再声明双轨栅格）—— 只断言 DOM 挡不住样式回归。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@/utils/i18n';
import { SettingsHost } from '@/features/shell/SettingsHost';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup.tsx';

const HARNESS_CSS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../src/render/styles/harness.css',
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

describe('SettingsHost · 设置弹窗', () => {
  beforeEach(() => {
    resetMockInvoke();
    localStorage.clear();
    mockInvoke('zhuye_get_config', async () => '[active]\nprovider = "anthropic"\n');
    mockInvoke('zhuye_agent_status', async () => ({
      has_model: true,
      model: 'anthropic/claude-sonnet-4',
      provider: 'anthropic',
    }));
  });
  afterEach(() => cleanup());

  it('打开时渲染弹窗骨架与设置内容', async () => {
    renderHost();
    expect(screen.getByTestId('harness-settings-modal')).toBeTruthy();
    // 内容区存在（v3 回归时这里被 200px 窄列挤没了）。
    await waitFor(() => {
      expect(screen.getByTestId('harness-settings-modal').textContent).toContain('Model Groups');
    });
  });

  it('分区导航的五个入口都在（模型组 / 权限 / 显示 / 通知 / 高级）', async () => {
    renderHost();
    await waitFor(() => {
      const modal = screen.getByTestId('harness-settings-modal');
      for (const label of ['Model Groups', 'Permissions', 'Display', 'Notifications', 'Advanced']) {
        expect(modal.textContent, `缺少分区:${label}`).toContain(label);
      }
    });
  });

  it('CSS 契约：.modal 是单列栅格（不得声明双轨）', () => {
    const css = readFileSync(HARNESS_CSS, 'utf8');
    const rule = css.match(/\.modal\s*\{([^}]*)\}/);
    expect(rule, 'harness.css 缺 .modal 规则').toBeTruthy();
    const body = rule?.[1] ?? '';
    const columns = body.match(/grid-template-columns\s*:\s*([^;]+);/);
    expect(columns, '.modal 缺 grid-template-columns 声明').toBeTruthy();
    // 单列 → 轨道描述里不应出现第二个长度/比例。
    const tracks = (columns?.[1] ?? '').trim().split(/\s+(?![^(]*\))/);
    expect(tracks.length, `.modal 应为单列,实际:${columns?.[1]}`).toBe(1);
  });

  it('CSS 契约：承载设置的 body 不自行滚动（滚动交给内层）', () => {
    const css = readFileSync(HARNESS_CSS, 'utf8');
    expect(css).toMatch(/\.ms-body\.flush\s*\{[^}]*overflow:\s*hidden/);
  });
});
