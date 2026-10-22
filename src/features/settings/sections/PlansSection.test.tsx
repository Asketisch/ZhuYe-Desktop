import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { I18nProvider } from '@/utils/i18n';
import { reflect_query_plan_quota, reflect_list_provider_models, reflect_test_provider_chat } from '@/utils/commands';
import { PlansSection } from './PlansSection';
import { AUTO_FAILOVER_PREF_KEY } from '@/stores/agent/planFailover';
import { readActiveProvider } from '../config/plans';

// 只替换余量查询 / 模型列表 IPC，其余 barrel 导出保持真实实现。
vi.mock('@/utils/commands', async () => {
  const actual = await vi.importActual<typeof import('@/utils/commands')>('@/utils/commands');
  return {
    ...actual,
    reflect_query_plan_quota: vi.fn(),
    reflect_list_provider_models: vi.fn(),
    reflect_test_provider_chat: vi.fn(),
  };
});

const QUOTA_OK = {
  success: true,
  error: null,
  utilization: 42.0,
  remaining_tokens: 80000,
  max_tokens: 120000,
  resets_at: '2026-08-28T18:00:00Z',
};

const SAMPLE_TOML = `[active]
provider = "anthropic"

[anthropic]
api_key = "sk-top-9999"

[[anthropic.credentials]]
label = "glm-plan"
api_key = "sk-glm-abcd"
base_url = "https://open.bigmodel.cn/api/anthropic"
model = "glm-4.7"
quota = { window_secs = 3600, max_tokens = 120000, check_via = "zhipu" }

[openai]
api_key = "sk-oai-1234"
`;

function renderSection(rawToml: string, onChange = vi.fn(), onCommit = vi.fn()) {
  render(
    <I18nProvider>
      <PlansSection rawToml={rawToml} onChange={onChange} onCommit={onCommit} />
    </I18nProvider>,
  );
  return { onChange, onCommit };
}

describe('PlansSection', () => {
  beforeEach(() => {
    localStorage.removeItem(AUTO_FAILOVER_PREF_KEY);
    vi.mocked(reflect_query_plan_quota).mockReset();
  });
  afterEach(() => {
    localStorage.removeItem(AUTO_FAILOVER_PREF_KEY);
  });

  it('渲染计划卡片(顶层 + credentials 条目)与额度徽标', () => {
    renderSection(SAMPLE_TOML);
    expect(screen.getByText('glm-plan')).toBeTruthy();
    expect(screen.getByText('••••abcd')).toBeTruthy();
    // 额度徽标 + 表单下拉 option 都会渲染 'zhipu'。
    expect(screen.getAllByText('zhipu').length).toBeGreaterThanOrEqual(1);
    // 顶层隐式条目也列出(default + top-level 徽标)。
    expect(screen.getAllByText('default').length).toBeGreaterThanOrEqual(1);
  });

  it('点击非默认供应商卡片 → onChange/onCommit 写入 [active].provider', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    renderSection(SAMPLE_TOML, onChange, onCommit);
    fireEvent.click(screen.getByTestId('provider-default-openai'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(readActiveProvider(onChange.mock.calls[0][0] as string)).toBe('openai');
    // 落盘回调收到同一份 TOML（「保存了却选不到模型」的回归锚）。
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0]).toBe(onChange.mock.calls[0][0]);
  });

  it('填写表单保存 → onChange/onCommit 追加新的 [[provider.credentials]] 块', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    renderSection(SAMPLE_TOML, onChange, onCommit);
    fireEvent.change(screen.getByPlaceholderText('e.g. glm-coding-plan'), {
      target: { value: 'minimax-plan' },
    });
    fireEvent.change(screen.getByPlaceholderText('sk-…'), { target: { value: 'sk-mm' } });
    fireEvent.click(screen.getByText('Save plan'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as string;
    expect(next).toContain('label = "minimax-plan"');
    expect(next).toContain('api_key = "sk-mm"');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0]).toBe(next);
  });

  it('删除计划 → onChange 移除对应块', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    renderSection(SAMPLE_TOML, onChange, onCommit);
    const glmCard = screen.getByText('glm-plan').closest('div[class*="providerCard"]') as HTMLElement;
    fireEvent.click(within(glmCard).getByText('Delete'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0] as string).not.toContain('glm-plan');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0]).toBe(onChange.mock.calls[0][0]);
  });

  it('自动切换开关写入 localStorage 偏好', () => {
    renderSection(SAMPLE_TOML);
    // 第一个 = 额度耗尽自动切换;第二个 = 按最大上下文自动压缩。
    const checkbox = screen.getAllByRole('checkbox')[0];
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    fireEvent.click(checkbox);
    expect(localStorage.getItem(AUTO_FAILOVER_PREF_KEY)).toBe('off');
    fireEvent.click(checkbox);
    expect(localStorage.getItem(AUTO_FAILOVER_PREF_KEY)).toBe('on');
  });

  it('查询余量 → 调 IPC 并渲染百分比 / 剩余 / 重置时间', async () => {
    vi.mocked(reflect_query_plan_quota).mockResolvedValueOnce(QUOTA_OK);
    renderSection(SAMPLE_TOML);
    fireEvent.click(screen.getByTestId('quota-query-glm-plan'));
    await waitFor(() => expect(screen.getByTestId('quota-result-glm-plan')).toBeTruthy());
    expect(vi.mocked(reflect_query_plan_quota)).toHaveBeenCalledWith(
      'https://open.bigmodel.cn/api/anthropic',
      'sk-glm-abcd',
      'zhipu',
    );
    const result = screen.getByTestId('quota-result-glm-plan');
    expect(within(result).getByText('Used 42.0%')).toBeTruthy();
    expect(within(result).getByText('80,000 tokens left')).toBeTruthy();
    expect(within(result).getByText(/Resets/)).toBeTruthy();
  });

  it('查询失败（鉴权/网络）→ 卡片内展示错误而非抛出', async () => {
    vi.mocked(reflect_query_plan_quota).mockResolvedValueOnce({
      success: false,
      error: 'Authentication failed (HTTP 401)',
      utilization: null,
      remaining_tokens: null,
      max_tokens: null,
      resets_at: null,
    });
    renderSection(SAMPLE_TOML);
    fireEvent.click(screen.getByTestId('quota-query-glm-plan'));
    await waitFor(() => expect(screen.getByTestId('quota-result-glm-plan')).toBeTruthy());
    expect(
      within(screen.getByTestId('quota-result-glm-plan')).getByText(
        'Query failed: Authentication failed (HTTP 401)',
      ),
    ).toBeTruthy();
  });

  it('未配置 check_via 的 plan 不显示查询按钮', () => {
    renderSection(SAMPLE_TOML);
    // openai 顶层条目没有 quota 子表 → 无查询入口。
    expect(screen.queryByTestId('quota-query-default')).toBeNull();
    expect(screen.getByTestId('quota-query-glm-plan')).toBeTruthy();
  });

  it('填入 base_url + api_key 后可从接口拉取模型列表', async () => {
    vi.mocked(reflect_list_provider_models).mockResolvedValueOnce({
      endpoint: 'anthropic',
      models: [
        { id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5', supports_vision: null, is_free: null, context_window: 200000 },
        { id: 'claude-haiku-4', display_name: 'Claude Haiku 4', supports_vision: true, is_free: false, context_window: null },
      ],
    });
    renderSection(SAMPLE_TOML);
    fireEvent.change(screen.getByPlaceholderText('https://open.bigmodel.cn/api/anthropic'), {
      target: { value: 'https://open.bigmodel.cn/api/anthropic' },
    });
    fireEvent.change(screen.getByPlaceholderText('sk-…'), { target: { value: 'sk-new' } });
    fireEvent.click(screen.getByTestId('plans-fetch-models'));
    await waitFor(() =>
      expect(vi.mocked(reflect_list_provider_models)).toHaveBeenCalledWith(
        'https://open.bigmodel.cn/api/anthropic',
        'sk-new',
        'anthropic',
      ),
    );
    await waitFor(() => expect(screen.getByText('2 models fetched')).toBeTruthy());
    // 拉取结果必须是显式可点击列表(WKWebView 的 datalist 不可靠):
    // 点击候选即填入 model 输入框。
    const options = screen.getByTestId('plans-model-options');
    expect(within(options).getAllByRole('option')).toHaveLength(2);
    const modelInput = screen.getByPlaceholderText('claude-sonnet-4 / glm-4.7 …') as HTMLInputElement;
    expect(modelInput.value).toBe('');
    fireEvent.click(within(options).getByText('claude-haiku-4'));
    expect(modelInput.value).toBe('claude-haiku-4');
    // 已选项高亮(data-active + aria-selected)。
    expect(within(options).getByText('claude-haiku-4').closest('button')?.getAttribute('aria-selected')).toBe('true');
  });

  it('测试连接：调模型列表接口（零 token），成功显示 ✓', async () => {
    vi.mocked(reflect_list_provider_models).mockResolvedValueOnce({
      endpoint: 'anthropic',
      models: [{ id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5', supports_vision: null, is_free: null, context_window: null }],
    });
    renderSection(SAMPLE_TOML);
    // 表单默认为空(按钮禁用),先填 base_url + api_key。
    fireEvent.change(screen.getByPlaceholderText('https://open.bigmodel.cn/api/anthropic'), {
      target: { value: 'https://open.bigmodel.cn/api/anthropic' },
    });
    fireEvent.change(screen.getByPlaceholderText('sk-…'), { target: { value: 'sk-new' } });
    fireEvent.click(screen.getByTestId('plans-test-connection'));
    await waitFor(() =>
      expect(vi.mocked(reflect_list_provider_models)).toHaveBeenCalledWith(
        'https://open.bigmodel.cn/api/anthropic',
        'sk-new',
        'anthropic',
      ),
    );
    await waitFor(() => expect(screen.getByText(/Connection OK/)).toBeTruthy());
  });

  it('发送测试消息：以表单模型调 chat 测试并展示回复', async () => {
    vi.mocked(reflect_test_provider_chat).mockResolvedValueOnce({ reply: '你好！有什么可以帮你？' });
    renderSection(SAMPLE_TOML);
    // 编辑 glm-plan 回填 base_url/api_key/model。
    fireEvent.click(within(screen.getByText('glm-plan').closest('div[class*="providerCard"]') as HTMLElement).getByText('Edit'));
    fireEvent.click(screen.getByTestId('plans-test-chat'));
    await waitFor(() =>
      expect(vi.mocked(reflect_test_provider_chat)).toHaveBeenCalledWith(
        'https://open.bigmodel.cn/api/anthropic',
        'sk-glm-abcd',
        'anthropic',
        'glm-4.7',
      ),
    );
    await waitFor(() => expect(screen.getByTestId('plans-chat-reply').textContent).toContain('你好！'));
  });

  it('自动压缩开关写入 localStorage 偏好', () => {
    renderSection(SAMPLE_TOML);
    const toggle = screen.getByTestId('plans-auto-compact') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(localStorage.getItem('reflect.autoCompact')).toBe('off');
  });
});
