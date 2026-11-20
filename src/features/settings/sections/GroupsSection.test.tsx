/**
 * Vitest — 模型组设置页(GroupsSection 主从布局:GroupNav + GroupDetail)。
 *
 * 覆盖:
 * 1. 左列表:只列模型组,选中即进入详情;「设为默认」开关写
 *    [active].group = 组 id(onChange/onCommit 收到同一份 TOML 的回归锚)
 * 2. 列表项展示组内凭据数量 + 凭据池健康点
 * 3. 自动切换 / 自动压缩开关(左列底部,switch)写入 localStorage
 * 4. GroupDetail:选中既有组 → 自动拉取模型 → 点选模型写组默认模型并落盘
 * 5. 新增组(groups-add 进入空表单):保存 → 自动拉取 → 组条目落盘
 * 6. 非法组 id(含 /)保存被拒且有提示,不落盘
 * 7. 组内凭据:新增 / 改字段 / 删除,并随组一起落盘
 * 8. 删除组 → onChange 移除该组全部归属块,选中回落
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@/utils/i18n';
import { zhuye_list_provider_models } from '@/utils/commands';
import { zhuye_credential_pool_status } from '@/utils/commands/runtimeStatus';
import { AUTO_FAILOVER_PREF_KEY } from '@/stores/agent/planFailover';
import { GroupsSection } from './GroupsSection';
import { clearModelCatalogCache } from '@/logic/settings/config/modelCatalog';
import { createTestQueryClient } from '@/test/setup';
import { listGroups, readActiveGroup } from '../config/groups';

// 只替换模型清单 / 凭据池健康 IPC，其余 barrel 导出保持真实实现。
vi.mock('@/utils/commands', async () => {
  const actual = await vi.importActual<typeof import('@/utils/commands')>('@/utils/commands');
  return {
    ...actual,
    zhuye_list_provider_models: vi.fn(),
  };
});
vi.mock('@/utils/commands/runtimeStatus', async () => {
  const actual = await vi.importActual<typeof import('@/utils/commands/runtimeStatus')>(
    '@/utils/commands/runtimeStatus',
  );
  return {
    ...actual,
    zhuye_credential_pool_status: vi.fn(),
  };
});

const SAMPLE_TOML = `[active]
group = "demo"

[[model_group]]
id = "demo"
label = "示例网关"
endpoint = "anthropic"
base_url = "http://127.0.0.1:3425"
api_key = "demo"
model = "demo/model-a"

[[model_group]]
id = "free-pool"
endpoint = "openai"
base_url = "https://free.example.test"

[[model_group.credentials]]
label = "backup"
api_key = "sk-backup"
`;

const FETCHED_MODELS = [
  { id: 'demo/model-a', display_name: 'Auto', supports_vision: true, is_free: null, context_window: 200000, max_output_tokens: null, supports_reasoning: null },
  { id: 'starter/GLM-5.3-Flash-Trial', display_name: '', supports_vision: null, is_free: true, context_window: 1000000, max_output_tokens: null, supports_reasoning: null },
];

function renderSection(rawToml: string, onChange = vi.fn(), onCommit = vi.fn()) {
  const queryClient = createTestQueryClient();
  // 有状态 harness:onChange 回流的 TOML 真实写回 props —— 与
  // SettingsBinding 的真实数据流一致(选中回落 / 新组跟随依赖它)。
  function Harness() {
    const [toml, setToml] = useState(rawToml);
    return (
      <GroupsSection
        rawToml={toml}
        onChange={(next) => {
          setToml(next);
          onChange(next);
        }}
        onCommit={onCommit}
      />
    );
  }
  render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <Harness />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { onChange, onCommit };
}

describe('GroupsSection 模型组页（主从布局）', () => {
  beforeEach(() => {
    localStorage.removeItem(AUTO_FAILOVER_PREF_KEY);
    vi.mocked(zhuye_list_provider_models).mockReset();
    vi.mocked(zhuye_credential_pool_status).mockReset();
    vi.mocked(zhuye_credential_pool_status).mockResolvedValue([]);
    clearModelCatalogCache();
  });

  it('左列表只列模型组;选中后「设为默认」开关写 [active].group = 组 id', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    renderSection(SAMPLE_TOML, onChange, onCommit);
    // 左列表项(选中即编辑)。
    expect(screen.getByTestId('group-edit-demo')).toBeTruthy();
    expect(screen.getByTestId('group-edit-free-pool')).toBeTruthy();
    // 内置端口卡片已随「提供商方案」层删除。
    expect(screen.queryByTestId('group-default-anthropic')).toBeNull();
    expect(screen.queryByTestId('group-default-openai')).toBeNull();
    // 初始选中默认组 demo → 详情头有 demo 的设为默认开关(开着)。
    const demoSwitch = screen.getByTestId('group-default-demo');
    expect(demoSwitch.getAttribute('aria-checked')).toBe('true');
    // 选中 free-pool → 开关关着 → 点击切换默认组。
    fireEvent.click(screen.getByTestId('group-edit-free-pool'));
    const poolSwitch = screen.getByTestId('group-default-free-pool');
    expect(poolSwitch.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(poolSwitch);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(readActiveGroup(onChange.mock.calls[0][0] as string)).toBe('free-pool');
    // 落盘回调收到同一份 TOML(「保存了却选不到」的回归锚)。
    expect(onCommit.mock.calls[0][0]).toBe(onChange.mock.calls[0][0]);
  });

  it('列表项展示组内凭据数量 + 凭据池健康点', async () => {
    vi.mocked(zhuye_credential_pool_status).mockResolvedValue([
      { group: 'demo', endpoint: 'anthropic', total: 2, healthy: 1, healthyLabels: ['a'] },
    ]);
    renderSection(SAMPLE_TOML);
    expect(screen.getByTestId('group-credential-count-demo').textContent).toContain('0');
    expect(screen.getByTestId('group-credential-count-free-pool').textContent).toContain('1');
    // 健康点:demo 有冷却中凭据 → 橙;free-pool 无池条目 → 灰。
    await waitFor(() =>
      expect(screen.getByTestId('group-edit-demo').querySelector('[data-state="cooling"]')).toBeTruthy(),
    );
    expect(screen.getByTestId('group-edit-free-pool').querySelector('[data-state="none"]')).toBeTruthy();
  });

  it('自动切换 / 自动压缩开关写入 localStorage 偏好', () => {
    renderSection(SAMPLE_TOML);
    const failover = screen.getByTestId('groups-auto-failover');
    expect(failover.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(failover);
    expect(localStorage.getItem(AUTO_FAILOVER_PREF_KEY)).toBe('off');
    fireEvent.click(failover);
    expect(localStorage.getItem(AUTO_FAILOVER_PREF_KEY)).toBe('on');
    const compact = screen.getByTestId('groups-auto-compact');
    fireEvent.click(compact);
    expect(localStorage.getItem('zhuye.autoCompact')).toBe('off');
  });

  it('选中既有组 → 自动拉取组内模型 → 点选模型写组默认模型并落盘', async () => {
    vi.mocked(zhuye_list_provider_models).mockResolvedValue({
      endpoint: 'anthropic',
      models: FETCHED_MODELS,
    });
    const onChange = vi.fn();
    const onCommit = vi.fn();
    renderSection(SAMPLE_TOML, onChange, onCommit);
    // 初始选中默认组 demo → 挂载即自动拉取(命中 TTL 缓存前打一次网络)。
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
    fireEvent.click(within(options).getByText('starter/GLM-5.3-Flash-Trial'));
    await waitFor(() => expect(onCommit).toHaveBeenCalled());
    const committed = onCommit.mock.calls.at(-1)![0] as string;
    expect(committed).toContain('id = "demo"');
    expect(committed).toContain('model = "starter/GLM-5.3-Flash-Trial"');
    expect(listGroups(committed)[0]?.model).toBe('starter/GLM-5.3-Flash-Trial');
  });

  it('新增组:进入空表单 → 保存 → 自动拉取 → 组条目落盘并跟随选中', async () => {
    vi.mocked(zhuye_list_provider_models).mockResolvedValue({
      endpoint: 'openai',
      models: [{ id: 'm1', display_name: '', supports_vision: null, is_free: null, context_window: null, max_output_tokens: null, supports_reasoning: null }],
    });
    const onChange = vi.fn();
    const onCommit = vi.fn();
    renderSection(SAMPLE_TOML, onChange, onCommit);
    // 页头「添加模型组」→ 详情切到新增模式(空表单)。
    fireEvent.click(screen.getByTestId('groups-add'));
    // 填新组表单:id / base_url(端点默认 openai)。
    fireEvent.change(screen.getByLabelText('Group ID'), { target: { value: 'free-pool-2' } });
    fireEvent.change(screen.getByLabelText('Base URL'), {
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
    const committed = onChange.mock.calls.at(-1)![0] as string;
    expect(committed).toContain('id = "free-pool-2"');
    expect(committed).toContain('endpoint = "openai"');
    // 选中跟随新组(列表项高亮)。
    await waitFor(() =>
      expect(screen.getByTestId('group-edit-free-pool-2').getAttribute('data-active')).toBe('true'),
    );
  });

  it('非法组 id(含 /)保存被拒且有提示,不落盘', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    renderSection(SAMPLE_TOML, onChange, onCommit);
    fireEvent.click(screen.getByTestId('groups-add'));
    fireEvent.change(screen.getByLabelText('Group ID'), { target: { value: 'a/b' } });
    fireEvent.click(screen.getByText('Save group'));
    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText(/Group ID must be non-empty/)).toBeTruthy();
  });

  it('组内凭据:新增 / 改字段 / 删除,并随组一起落盘', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    renderSection(SAMPLE_TOML, onChange, onCommit);
    // 选中 free-pool 组 → 详情带出已有凭据(凭据折叠区随凭据数自动展开)。
    fireEvent.click(screen.getByTestId('group-edit-free-pool'));
    const credential = screen.getByTestId('group-credential-0');
    expect((within(credential).getByLabelText('Credential label') as HTMLInputElement).value).toBe('backup');
    // 改权重。
    fireEvent.change(within(credential).getByLabelText('Weight'), { target: { value: '5' } });
    // 新增一条凭据并填标识。
    fireEvent.click(screen.getByTestId('group-credential-add'));
    const added = screen.getByTestId('group-credential-1');
    fireEvent.change(within(added).getByLabelText('Credential label'), { target: { value: 'extra' } });
    fireEvent.change(within(added).getByLabelText('API key'), { target: { value: 'sk-extra' } });
    // 保存组 → 凭据随组落盘。
    fireEvent.click(screen.getByText('Save group'));
    expect(onChange).toHaveBeenCalled();
    const committed = onChange.mock.calls.at(-1)![0] as string;
    expect(committed).toContain('[[model_group.credentials]]');
    expect(committed).toContain('label = "backup"');
    expect(committed).toContain('weight = 5');
    expect(committed).toContain('label = "extra"');
    expect(committed).toContain('api_key = "sk-extra"');
    // 删除一条凭据。
    fireEvent.click(screen.getByTestId('group-credential-delete-1'));
    fireEvent.click(screen.getByText('Save group'));
    const afterDelete = onChange.mock.calls.at(-1)![0] as string;
    expect(afterDelete).not.toContain('label = "extra"');
  });

  it('删除组 → onChange 移除该组全部归属块,选中回落到剩余组', async () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    renderSection(SAMPLE_TOML, onChange, onCommit);
    // 初始选中 demo → 详情头删除按钮直接可用。
    fireEvent.click(screen.getByTestId('group-delete-demo'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(listGroups(onChange.mock.calls[0][0] as string).map((g) => g.id)).toEqual(['free-pool']);
    expect(onCommit.mock.calls[0][0]).toBe(onChange.mock.calls[0][0]);
    // 选中回落:demo 已不存在 → 自动落到 free-pool。
    await waitFor(() =>
      expect(screen.getByTestId('group-edit-free-pool').getAttribute('data-active')).toBe('true'),
    );
  });
});
