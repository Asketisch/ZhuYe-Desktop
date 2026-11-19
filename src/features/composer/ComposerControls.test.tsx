/**
 * Vitest — ComposerControls 模型选择器的模型组支持。
 *
 * 覆盖:
 * 1. 自定义组([[provider_group]])与内置 plan 平级出现在选择器里
 * 2. 切到组 → reflect_set_model(组id, 组默认模型)
 * 3. active 是组时自动拉取组内模型,切到 model:<id> → 写组默认模型
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@/utils/i18n';
import { createTestQueryClient } from '@/test/setup.tsx';
import { clearModelCatalogCache } from '@/logic/settings/config/modelCatalog';
import { ComposerControls } from './ComposerControls';

vi.mock('@/utils/commands/config', async () => {
  const actual = await vi.importActual<typeof import('@/utils/commands/config')>('@/utils/commands/config');
  return {
    ...actual,
    reflect_get_config: vi.fn(),
    reflect_agent_status: vi.fn(),
    reflect_set_model: vi.fn(),
  };
});
vi.mock('@/utils/commands/models', async () => {
  const actual = await vi.importActual<typeof import('@/utils/commands/models')>('@/utils/commands/models');
  return {
    ...actual,
    reflect_list_provider_models: vi.fn(),
  };
});
vi.mock('@/utils/commands/permissions', async () => {
  const actual = await vi.importActual<typeof import('@/utils/commands/permissions')>('@/utils/commands/permissions');
  return {
    ...actual,
    reflect_get_effort: vi.fn().mockResolvedValue('low'),
    reflect_set_effort: vi.fn(),
  };
});

import {
  reflect_get_config,
  reflect_agent_status,
  reflect_set_model,
} from '@/utils/commands/config';
import { reflect_list_provider_models } from '@/utils/commands/models';

const GROUP_TOML = `[active]
provider = "magpie"

[[provider_group]]
id = "magpie"
label = "Magpie 网关"
endpoint = "anthropic"
base_url = "http://127.0.0.1:3425"
api_key = "magpie"
model = "cursor/auto"
`;

function renderControls() {
  return render(
    <I18nProvider>
      <QueryClientProvider client={createTestQueryClient()}>
        <ComposerControls />
      </QueryClientProvider>
    </I18nProvider>,
  );
}

describe('ComposerControls 模型组', () => {
  beforeEach(() => {
    // 清调用计数与模型清单 TTL 缓存(缓存跨用例存活,会让「自动拉取」
    // 命中上一用例的结果而不打 mock)。
    vi.clearAllMocks();
    clearModelCatalogCache();
    vi.mocked(reflect_get_config).mockResolvedValue(GROUP_TOML);
    vi.mocked(reflect_agent_status).mockResolvedValue({
      model: 'magpie/cursor/auto',
      has_model: true,
      degraded_reason: null,
      ready: true,
      workspace: '.',
    } as Awaited<ReturnType<typeof reflect_agent_status>>);
    vi.mocked(reflect_set_model).mockImplementation(
      async (provider: string, model: string) => `${provider}/${model}`,
    );
    vi.mocked(reflect_list_provider_models).mockResolvedValue({
      endpoint: 'anthropic',
      models: [
        { id: 'cursor/auto', display_name: 'Auto · Cursor', supports_vision: null, is_free: null, context_window: 200000, max_output_tokens: null, supports_reasoning: null },
        { id: 'zcode/GLM-5.3-Flash-Trial', display_name: '', supports_vision: null, is_free: true, context_window: 1000000, max_output_tokens: null, supports_reasoning: null },
      ],
    });
  });

  it('自定义组作为可选项渲染,active 是组时选中', async () => {
    renderControls();
    const select = (await screen.findByTestId('composer-model-select')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('group:magpie'));
    const option = screen.getByRole('option', { name: /Magpie 网关 · cursor\/auto/ });
    expect(option).toBeTruthy();
  });

  it('active 是组时自动拉取组内模型填入 optgroup', async () => {
    renderControls();
    // 先等 UI 状态(选项出现 = 拉取已完成),再断言调用参数 —— 顺序无关,
    // 避免跨用例的 act 刷新时序假失败。
    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: /zcode\/GLM-5.3-Flash-Trial/ }),
      ).toBeTruthy();
    });
    expect(vi.mocked(reflect_list_provider_models)).toHaveBeenCalledWith(
      'http://127.0.0.1:3425',
      'magpie',
      'anthropic',
    );
  });

  it('切到组选项 → reflect_set_model(组id, 组当前模型)', async () => {
    renderControls();
    const select = (await screen.findByTestId('composer-model-select')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('group:magpie'));
    // 已是选中态;切一次走 group:<id> 分支(改选同一值不触发 change,
    // 先切到 model 分支再切回,或直接派发 change 事件)。
    fireEvent.change(select, { target: { value: 'group:magpie' } });
    await waitFor(() =>
      expect(vi.mocked(reflect_set_model)).toHaveBeenCalledWith('magpie', 'cursor/auto'),
    );
  });

  it('从拉取列表切到 model:<id> → reflect_set_model(组id, 模型 id)', async () => {
    renderControls();
    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: /zcode\/GLM-5.3-Flash-Trial/ }),
      ).toBeTruthy();
    });
    const select = screen.getByTestId('composer-model-select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'model:zcode/GLM-5.3-Flash-Trial' } });
    await waitFor(() =>
      expect(vi.mocked(reflect_set_model)).toHaveBeenCalledWith(
        'magpie',
        'zcode/GLM-5.3-Flash-Trial',
      ),
    );
  });
});
