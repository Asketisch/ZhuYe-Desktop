/**
 * Vitest — EffortPicker（底栏右侧思考深度 pill）。
 *
 * 契约：挂载回读 zhuye_get_effort；变更乐观更新并调 zhuye_set_effort；
 * 选项 = 模型支持档位（当前显示值兜底保渲染安全）；显示值 = 当前
 * 模型生效档（capability.effective，换模型即重算 —— 不顶旧模型档位）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@/utils/i18n';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup.tsx';
import { EffortPicker } from './EffortPicker';

function renderPicker() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <I18nProvider><EffortPicker /></I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('zhuye.locale', 'zh-CN');
  resetMockInvoke();
  mockInvoke('zhuye_get_effort', async () => 'low');
  mockInvoke('zhuye_set_effort', async () => 'ok');
});

describe('EffortPicker', () => {
  it('挂载回读档位并显示英文原词选项;变更乐观更新并调 zhuye_set_effort', async () => {
    const calls: string[] = [];
    mockInvoke('zhuye_get_effort', async () => 'high');
    mockInvoke('zhuye_set_effort', async (_cmd: string, args?: { level: string }) => {
      calls.push(args?.level ?? '');
      return 'ok';
    });
    renderPicker();

    const select = await screen.findByTestId('composer-effort-select') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('high'));
    // 档位文案为英文原词（协议档位字，不本地化）。
    const labels = [...select.options].map((o) => o.textContent);
    expect(labels).toContain('high');
    expect(labels).toContain('low');

    fireEvent.change(select, { target: { value: 'low' } });
    expect(select.value).toBe('low');
    await waitFor(() => expect(calls).toContain('low'));
  });

  it('能力未知时展示全部档位（兜底）', async () => {
    // 默认 stub 的 capability 返回 known=false（setup 里 zhuye_effort_capability
    // 未被覆写时走 fallback 兜底视图）。
    renderPicker();
    const select = await screen.findByTestId('composer-effort-select') as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(5));
  });

  it('切到上限更低的模型后显示生效档 —— 不顶旧模型偏好,下拉不含 max', async () => {
    mockInvoke('zhuye_get_effort', async () => 'max');
    mockInvoke('zhuye_effort_capability', async () => ({
      model: 'openai/qwen3.8-27b-nvfp4',
      supported: ['low', 'medium', 'high'],
      known: true,
      requested: 'max',
      effective: 'high',
      adjusted: true,
    }));
    renderPicker();
    const select = await screen.findByTestId('composer-effort-select') as HTMLSelectElement;
    // 显示 = 钳制后的生效档(high),而非槽位原始偏好(max)。
    await waitFor(() => expect(select.value).toBe('high'));
    const values = [...select.options].map((o) => o.value);
    expect(values).not.toContain('max');
    expect(values).toEqual(['low', 'medium', 'high']);
  });

  it('切回支持偏好的模型自动恢复显示 max（钳制是无损投影）', async () => {
    mockInvoke('zhuye_get_effort', async () => 'max');
    mockInvoke('zhuye_effort_capability', async () => ({
      model: 'openai/gpt-5',
      supported: ['low', 'medium', 'high', 'max', 'ultra'],
      known: true,
      requested: 'max',
      effective: 'max',
      adjusted: false,
    }));
    renderPicker();
    const select = await screen.findByTestId('composer-effort-select') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('max'));
  });
});
