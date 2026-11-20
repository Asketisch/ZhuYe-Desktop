/**
 * Vitest — 模型组统一设置页(GroupsSection + GroupForm)。
 *
 * 覆盖:
 * 1. 默认组卡片:内置端口与自定义组平铺,点击写 [active].provider
 * 2. 自动切换开关写入 localStorage(自 PlansSection 上移)
 * 3. GroupForm:保存组 → 自动拉取模型 → 点选模型写组默认模型并落盘
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { I18nProvider } from '@/utils/i18n';
import { zhuye_list_provider_models } from '@/utils/commands';
import {
  AUTO_FAILOVER_PREF_KEY,
} from '@/stores/agent/planFailover';
import { GroupsSection } from './GroupsSection';
import { clearModelCatalogCache } from '@/logic/settings/config/modelCatalog';
import { readActiveProvider } from '../config/plans';
import { listGroups } from '../config/groups';

// 只替换模型列表 IPC，其余 barrel 导出保持真实实现。
vi.mock('@/utils/commands', async () => {
  const actual = await vi.importActual<typeof import('@/utils/commands')>('@/utils/commands');
  return {
    ...actual,
    zhuye_list_provider_models: vi.fn(),
  };
});

const SAMPLE_TOML = `[active]
provider = "anthropic"

[anthropic]
api_key = "sk-top-9999"

[openai]
api_key = "sk-oai-1234"

[[provider_group]]
id = "demo"
label = "示例网关"
endpoint = "anthropic"
base_url = "http://127.0.0.1:3425"
api_key = "demo"
model = "demo/model-a"
`;

const FETCHED_MODELS = [
  { id: 'demo/model-a', display_name: 'Auto', supports_vision: true, is_free: null, context_window: 200000, max_output_tokens: null, supports_reasoning: null },
  { id: 'zcode/GLM-5.3-Flash-Trial', display_name: '', supports_vision: null, is_free: true, context_window: 1000000, max_output_tokens: null, supports_reasoning: null },
];

function renderSection(rawToml: string, onChange = vi.fn(), onCommit = vi.fn()) {
  render(
    <I18nProvider>
      <GroupsSection rawToml={rawToml} onChange={onChange} onCommit={onCommit} />
    </I18nProvider>,
  );
  return { onChange, onCommit };
}

describe('GroupsSection 统一模型组页', () => {
  beforeEach(() => {
    localStorage.removeItem(AUTO_FAILOVER_PREF_KEY);
    vi.mocked(zhuye_list_provider_models).mockReset();
    clearModelCatalogCache();
  });

  it('默认组卡片平铺内置端口与自定义组,点击组卡片写 [active].provider = 组 id', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    renderSection(SAMPLE_TOML, onChange, onCommit);
    // 内置端口卡片(有可用 plan 才出现)。
    expect(screen.getByTestId('provider-default-anthropic')).toBeTruthy();
    expect(screen.getByTestId('provider-default-openai')).toBeTruthy();
    // 自定义组卡片。
    expect(screen.getByTestId('provider-default-group-demo')).toBeTruthy();
    fireEvent.click(screen.getByTestId('provider-default-group-demo'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(readActiveProvider(onChange.mock.calls[0][0] as string)).toBe('demo');
    // 落盘回调收到同一份 TOML(「保存了却选不到」的回归锚)。
    expect(onCommit.mock.calls[0][0]).toBe(onChange.mock.calls[0][0]);
  });

  it('自动切换 / 自动压缩开关写入 localStorage 偏好', () => {
    renderSection(SAMPLE_TOML);
    // 页面里有多个复选框(GroupForm 的 responses_api 高级开关也在),
    // 按可访问名称定位,不按下标猜。
    const failover = screen.getByRole('checkbox', {
      name: 'Switch default provider automatically when a plan is exhausted',
    }) as HTMLInputElement;
    expect(failover.checked).toBe(true);
    fireEvent.click(failover);
    expect(localStorage.getItem(AUTO_FAILOVER_PREF_KEY)).toBe('off');
    fireEvent.click(failover);
    expect(localStorage.getItem(AUTO_FAILOVER_PREF_KEY)).toBe('on');
    const compact = screen.getByTestId('plans-auto-compact') as HTMLInputElement;
    expect(compact.checked).toBe(true);
    fireEvent.click(compact);
    expect(localStorage.getItem('zhuye.autoCompact')).toBe('off');
  });

  it('编辑既有组 → 自动拉取组内模型 → 点选模型写组默认模型并落盘', async () => {
    vi.mocked(zhuye_list_provider_models).mockResolvedValue({
      endpoint: 'anthropic',
      models: FETCHED_MODELS,
    });
    const onChange = vi.fn();
    const onCommit = vi.fn();
    renderSection(SAMPLE_TOML, onChange, onCommit);
    // 打开编辑表单 → 触发自动拉取(命中 TTL 缓存前打一次网络)。
    fireEvent.click(screen.getByTestId('group-edit-demo'));
    await waitFor(() =>
      expect(vi.mocked(zhuye_list_provider_models)).toHaveBeenCalledWith(
        'http://127.0.0.1:3425',
        'demo',
        'anthropic',
      ),
    );
    await waitFor(() => expect(screen.getByText('2 models fetched')).toBeTruthy());
    // 显式可点击 listbox:点选模型 → upsert 组默认模型 → onCommit。
    const options = screen.getByTestId('groups-model-options');
    expect(within(options).getAllByRole('option')).toHaveLength(2);
    fireEvent.click(within(options).getByText('zcode/GLM-5.3-Flash-Trial'));
    await waitFor(() => expect(onCommit).toHaveBeenCalled());
    const committed = onCommit.mock.calls.at(-1)![0] as string;
    expect(committed).toContain('id = "demo"');
    expect(committed).toContain('model = "zcode/GLM-5.3-Flash-Trial"');
    expect(listGroups(committed)[0]?.model).toBe('zcode/GLM-5.3-Flash-Trial');
  });

  it('新增组:保存 → 自动拉取 → 组条目落盘', async () => {
    vi.mocked(zhuye_list_provider_models).mockResolvedValue({
      endpoint: 'openai',
      models: [{ id: 'm1', display_name: '', supports_vision: null, is_free: null, context_window: null, max_output_tokens: null, supports_reasoning: null }],
    });
    const onChange = vi.fn();
    const onCommit = vi.fn();
    renderSection(SAMPLE_TOML, onChange, onCommit);
    // 填新组表单:id / base_url / api_key(endpoint 默认 openai)。
    fireEvent.change(screen.getByPlaceholderText('bigmodel'), { target: { value: 'free-pool' } });
    fireEvent.change(screen.getByPlaceholderText('https://open.bigmodel.cn/api/paas/v4'), {
      target: { value: 'https://free.example.test' },
    });
    fireEvent.click(screen.getByText('Save group'));
    // 保存触发自动拉取(免 Key openai 端点)。
    await waitFor(() =>
      expect(vi.mocked(zhuye_list_provider_models)).toHaveBeenCalledWith(
        'https://free.example.test',
        '',
        'openai',
      ),
    );
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const committed = (onChange.mock.calls.at(-1)![0] as string);
    expect(committed).toContain('id = "free-pool"');
    expect(committed).toContain('endpoint = "openai"');
  });

  it('非法组 id(含 /)保存被拒且有提示,不落盘', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    renderSection(SAMPLE_TOML, onChange, onCommit);
    fireEvent.change(screen.getByPlaceholderText('bigmodel'), { target: { value: 'a/b' } });
    fireEvent.click(screen.getByText('Save group'));
    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText(/Group ID must be non-empty/)).toBeTruthy();
  });

  it('删除组 → onChange 移除该组全部归属块', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    renderSection(SAMPLE_TOML, onChange, onCommit);
    fireEvent.click(screen.getByTestId('group-delete-demo'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(listGroups(onChange.mock.calls[0][0] as string)).toHaveLength(0);
    expect(onCommit.mock.calls[0][0]).toBe(onChange.mock.calls[0][0]);
  });
});
