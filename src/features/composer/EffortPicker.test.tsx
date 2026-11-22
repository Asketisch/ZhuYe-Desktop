/**
 * Vitest — EffortPicker（底栏右侧思考深度 pill）。
 *
 * 契约：挂载回读 zhuye_get_effort；变更乐观更新并调 zhuye_set_effort；
 * 选项 = 模型支持档位 ∪ 当前选择（能力未知时全档展示）。
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
  it('挂载回读档位并映射为中文选项;变更乐观更新并调 zhuye_set_effort', async () => {
    const calls: string[] = [];
    mockInvoke('zhuye_get_effort', async () => 'high');
    mockInvoke('zhuye_set_effort', async (_cmd: string, args?: { level: string }) => {
      calls.push(args?.level ?? '');
      return 'ok';
    });
    renderPicker();

    const select = await screen.findByTestId('composer-effort-select') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('high'));
    // 中文档位文案（i18n 映射）。
    const labels = [...select.options].map((o) => o.textContent);
    expect(labels).toContain('高');
    expect(labels).toContain('低');

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
});
