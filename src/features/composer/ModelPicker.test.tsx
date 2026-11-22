/**
 * Vitest — ModelPicker 模型选择器（只列模型组）。
 *
 * 模型选择器渲染在输入卡片底栏右侧，新契约：
 * 1. 选项只来自模型组（`[[model_group]]`）与组内凭据，不再有编码套餐段；
 * 2. 选中态单一事实源 = `[active].group` + `[active].credential`；
 * 3. 切到组 → zhuye_set_model(组id, 组模型)
 *    切到组内凭据 → zhuye_set_model(组id, 凭据模型, 凭据label)
 *    切到接口模型 → zhuye_set_model(组id, 模型id)（写组级默认模型）
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@/utils/i18n';
import { createTestQueryClient } from '@/test/setup.tsx';
import { clearModelCatalogCache } from '@/logic/settings/config/modelCatalog';
import { ModelPicker } from './ModelPicker';

vi.mock('@/utils/commands/config', async () => {
  const actual = await vi.importActual<typeof import('@/utils/commands/config')>('@/utils/commands/config');
  return {
    ...actual,
    zhuye_get_config: vi.fn(),
    zhuye_agent_status: vi.fn(),
    zhuye_set_model: vi.fn(),
  };
});
vi.mock('@/utils/commands/models', async () => {
  const actual = await vi.importActual<typeof import('@/utils/commands/models')>('@/utils/commands/models');
  return {
    ...actual,
    zhuye_list_provider_models: vi.fn(),
  };
});
vi.mock('@/utils/commands/permissions', async () => {
  const actual = await vi.importActual<typeof import('@/utils/commands/permissions')>('@/utils/commands/permissions');
  return {
    ...actual,
    zhuye_get_effort: vi.fn().mockResolvedValue('low'),
    zhuye_set_effort: vi.fn(),
  };
});

import {
  zhuye_get_config,
  zhuye_agent_status,
  zhuye_set_model,
} from '@/utils/commands/config';
import { zhuye_list_provider_models } from '@/utils/commands/models';

const GROUP_TOML = `[active]
group = "demo"

[[model_group]]
id = "demo"
label = "示例网关"
endpoint = "anthropic"
base_url = "http://127.0.0.1:3425"
api_key = "demo"
model = "demo/model-a"

[[model_group.credentials]]
label = "备用"
api_key = "demo-alt"
model = "demo/model-b"
`;

const PINNED_TOML = `[active]
group = "demo"
credential = "备用"

[[model_group]]
id = "demo"
label = "示例网关"
endpoint = "anthropic"
base_url = "http://127.0.0.1:3425"
api_key = "demo"
model = "demo/model-a"

[[model_group.credentials]]
label = "备用"
api_key = "demo-alt"
model = "demo/model-b"
`;

function renderPicker() {
  return render(
    <I18nProvider>
      <QueryClientProvider client={createTestQueryClient()}>
        <ModelPicker />
      </QueryClientProvider>
    </I18nProvider>,
  );
}

describe('ModelPicker 模型组', () => {
  beforeEach(() => {
    // 清调用计数与模型清单 TTL 缓存(缓存跨用例存活,会让「自动拉取」
    // 命中上一用例的结果而不打 mock)。
    vi.clearAllMocks();
    clearModelCatalogCache();
    vi.mocked(zhuye_get_config).mockResolvedValue(GROUP_TOML);
    vi.mocked(zhuye_agent_status).mockResolvedValue({
      model: 'demo/model-a',
      has_model: true,
      degraded_reason: null,
      ready: true,
      workspace: '.',
    } as Awaited<ReturnType<typeof zhuye_agent_status>>);
    vi.mocked(zhuye_set_model).mockImplementation(
      async (group: string, model: string) => `${group}/${model}`,
    );
    vi.mocked(zhuye_list_provider_models).mockResolvedValue({
      endpoint: 'anthropic',
      models: [
        { id: 'demo/model-a', display_name: 'Auto', supports_vision: null, is_free: null, context_window: 200000, max_output_tokens: null, effort_levels: null, supports_reasoning: null },
        { id: 'starter/GLM-5.3-Flash-Trial', display_name: '', supports_vision: null, is_free: true, context_window: 1000000, max_output_tokens: null, effort_levels: null, supports_reasoning: null },
      ],
    });
  });

  it('模型组作为可选项渲染,active 是组时选中', async () => {
    renderPicker();
    const select = (await screen.findByTestId('composer-model-select')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('group:demo'));
    const option = screen.getByRole('option', { name: /示例网关 · demo\/model-a/ });
    expect(option).toBeTruthy();
  });

  it('组内凭据渲染为独立选项(凭据 label 区分,不留同名项)', async () => {
    renderPicker();
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /示例网关 · 备用/ })).toBeTruthy();
    });
    // 组项与凭据项的文案不同 —— 用户能看出自己切的是哪一条。
    expect(screen.getByRole('option', { name: /示例网关 · demo\/model-a/ })).toBeTruthy();
  });

  it('active 是组时自动拉取组内模型填入 optgroup', async () => {
    renderPicker();
    // 先等 UI 状态(选项出现 = 拉取已完成),再断言调用参数 —— 顺序无关,
    // 避免跨用例的 act 刷新时序假失败。
    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: /starter\/GLM-5.3-Flash-Trial/ }),
      ).toBeTruthy();
    });
    expect(vi.mocked(zhuye_list_provider_models)).toHaveBeenCalledWith(
      'http://127.0.0.1:3425',
      'demo',
      'anthropic',
    );
  });

  it('切到组选项 → zhuye_set_model(组id, 组当前模型)', async () => {
    renderPicker();
    const select = (await screen.findByTestId('composer-model-select')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('group:demo'));
    // 已是选中态;改选同一值不触发 change,直接派发 change 事件。
    fireEvent.change(select, { target: { value: 'group:demo' } });
    await waitFor(() =>
      expect(vi.mocked(zhuye_set_model)).toHaveBeenCalledWith('demo', 'demo/model-a'),
    );
  });

  it('切到组内凭据 → zhuye_set_model(组id, 凭据模型, 凭据label)', async () => {
    renderPicker();
    const select = (await screen.findByTestId('composer-model-select')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('group:demo'));
    fireEvent.change(select, { target: { value: 'cred:demo:备用' } });
    await waitFor(() =>
      expect(vi.mocked(zhuye_set_model)).toHaveBeenCalledWith('demo', 'demo/model-b', '备用'),
    );
  });

  it('[active].credential 钉住凭据时,选中态落在凭据项', async () => {
    vi.mocked(zhuye_get_config).mockResolvedValue(PINNED_TOML);
    renderPicker();
    const select = (await screen.findByTestId('composer-model-select')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('cred:demo:备用'));
  });

  it('从拉取列表切到 model:<id> → zhuye_set_model(组id, 模型 id)', async () => {
    renderPicker();
    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: /starter\/GLM-5.3-Flash-Trial/ }),
      ).toBeTruthy();
    });
    const select = screen.getByTestId('composer-model-select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'model:starter/GLM-5.3-Flash-Trial' } });
    await waitFor(() =>
      expect(vi.mocked(zhuye_set_model)).toHaveBeenCalledWith(
        'demo',
        'starter/GLM-5.3-Flash-Trial',
      ),
    );
  });

  it('没有模型组时展示「未配置模型」占位', async () => {
    vi.mocked(zhuye_get_config).mockResolvedValue('[active]\ngroup = ""\n');
    renderPicker();
    const select = (await screen.findByTestId('composer-model-select')) as HTMLSelectElement;
    await waitFor(() => expect(select.disabled).toBe(true));
    expect(select.options).toHaveLength(1);
  });
});
