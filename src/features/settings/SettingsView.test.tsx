/**
 * Vitest — SettingsView 组件测试(阶段 4:真实 config 持久化)。
 *
 * 验证:
 * 1. 渲染 Model Groups / Permissions / Advanced sections
 * 2. 显示 agent 状态徽标(从 zhuye_agent_status)
 * 3. permission 按钮点击调 zhuye_set_permission_mode
 * 4. Save 按钮调 zhuye_save_config
 * 5. 全量结构化表单为所有 ZhuyeConfig 段提供直接输入框
 * 6. 「提供商方案」层已移除 —— 结构化表单不再承载 anthropic / openai 段
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { SettingsView } from '@/features/settings/SettingsView';
import { I18nProvider } from '@/utils/i18n';
import {
  mockInvoke,
  resetMockInvoke,
  createTestQueryClient,
} from '@/test/setup.tsx';
import { readField, applyField } from '@/features/settings/configSchema';
import { getUiPrefs, resetUiPrefsForTests } from '@/utils/uiPrefs';
import { getTheme } from '@/utils/theme';

function renderSettingsView() {
  return render(
    <I18nProvider>
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsView />
      </QueryClientProvider>
    </I18nProvider>,
  );
}

const SAMPLE_TOML = `[active]
group = "demo"

[[model_group]]
id = "demo"
label = "示例组"
endpoint = "openai"
api_key = "sk-existing"
model = "gpt-4o"

[model]
context_window = 200000

[compact]
trigger_tokens = 1024

[mcp_servers.filesystem]
type = "stdio"
command = "npx"

[hooks.search_budget]
max_calls = 25
`;

describe('SettingsView', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('zhuye.locale', 'en');
    resetUiPrefsForTests();
    resetMockInvoke();
    mockInvoke('zhuye_set_permission_mode', async () => {});
    mockInvoke('zhuye_save_config', async () => {});
    mockInvoke('zhuye_get_config', async () => SAMPLE_TOML);
    mockInvoke('zhuye_agent_status', async () => ({
      ready: true,
      has_model: true,
      model: 'anthropic/claude-3-5-sonnet-latest',
      workspace: '/tmp',
      degraded_reason: null,
    }));
  });
  afterEach(() => cleanup());

  it('renders Model settings / Behavior / Advanced sections', async () => {
    renderSettingsView();
    // 分区标题出现在内容区（h2），导航按钮同名，用 getAllByText。
    expect(screen.getAllByText('Model settings').length).toBeGreaterThanOrEqual(1);
    // 「提供商」导航项已随提供商方案层删除。
    expect(screen.queryByText('Provider')).toBeNull();
    expect(screen.getAllByText('Behavior and tools').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Advanced/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows agent ready status badge when has_model', async () => {
    renderSettingsView();
    // 状态徽标在「模型设置」分区头（默认分区即 groups）。
    await waitFor(() => {
      expect(screen.getByText(/Agent ready/)).toBeDefined();
    });
  });

  it('clicking permission segment calls zhuye_set_permission_mode', async () => {
    let modeArg: string | null = null;
    mockInvoke('zhuye_set_permission_mode', async (_cmd: string, args: unknown) => {
      modeArg = (args as { mode: string }).mode;
    });

    renderSettingsView();
    // 权限控件在「行为与工具」分区。
    fireEvent.click(screen.getByTestId('settings-section-behavior'));
    // permission 分段按钮文案:auto/prompt/plan。
    const planBtn = await screen.findByText('Plan', { selector: 'button' });
    fireEvent.click(planBtn);

    await waitFor(() => expect(modeArg).toBe('plan'), { timeout: 2000 });
  });

  it('preserves edits made while a save is in flight and config refetches', async () => {
    let finish!: () => void;
    let saved = SAMPLE_TOML;
    let reads = 0;
    mockInvoke('zhuye_save_config', async (_cmd, args) => {
      const submitted = (args as { toml: string }).toml;
      await new Promise<void>((resolve) => { finish = resolve; });
      saved = submitted;
    });
    mockInvoke('zhuye_get_config', async () => { reads += 1; return saved; });
    renderSettingsView();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    const editor = await screen.findByRole('textbox', { name: 'Advanced (raw TOML)' }) as HTMLTextAreaElement;
    await waitFor(() => expect(editor.value).toBe(SAMPLE_TOML));
    const first = `${SAMPLE_TOML}\n# saved edit`;
    const second = `${first}\n# later edit`;
    fireEvent.change(editor, { target: { value: first } });
    fireEvent.click(screen.getByRole('button', { name: /Save to/ }));
    await waitFor(() => expect(finish).toBeDefined());
    fireEvent.change(editor, { target: { value: second } });
    await act(async () => { finish(); });
    await waitFor(() => expect(reads).toBeGreaterThan(1));
    expect(editor.value).toBe(second);
    expect(saved).toBe(first);
  });

  it('Save button calls zhuye_save_config with merged TOML', async () => {
    let savedToml: string | null = null;
    // TEMP-DEBUG
    mockInvoke('zhuye_save_config', async (_cmd: string, args: unknown) => {
      savedToml = (args as { toml: string }).toml;
    });

    renderSettingsView();
    // 保存条在「高级」分区底部（config 表单所在页）。
    fireEvent.click(screen.getByTestId('settings-section-advanced'));
    // 等 config 加载完成（raw TOML 编辑框被 seed）→ 保存按钮才可用。
    const editor = await screen.findByRole('textbox', { name: 'Advanced (raw TOML)' }) as HTMLTextAreaElement;
    await waitFor(() => expect(editor.value).toBe(SAMPLE_TOML));

    fireEvent.click(screen.getByText('Save to ~/.zhuye/config.toml'));
    await waitFor(() => expect(savedToml).not.toBeNull(), { timeout: 2000 });
    // 合并后的 TOML 应保留 active + model_group 段(SAMPLE_TOML 的内容)。
    expect(savedToml).toContain('[active]');
    expect(savedToml).toContain('group = "demo"');
    expect(savedToml).toContain('[[model_group]]');
    expect(savedToml).toContain('sk-existing');
  });

  it('renders direct structured inputs for every ZhuyeConfig section', async () => {
    renderSettingsView();
    // 结构化表单挂在「高级」页（模型接入已由「模型组」页承载）。
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    // 提供商方案层已移除 —— 结构化表单不再有 anthropic / openai 段与
    // active.provider 下拉（模型组页统一承载）。
    expect(screen.queryByLabelText(/Anthropic API key/)).toBeNull();
    expect(screen.queryByLabelText(/OpenAI API key/)).toBeNull();
    expect(screen.queryByLabelText(/^Active provider$/)).toBeNull();
    // Compact / token_budget 段已移除 —— 压缩触发下沉为模型组级
    // auto_compact（模型组页），token 预算属引擎底层治理参数。
    expect(screen.queryByLabelText(/Compact trigger tokens/)).toBeNull();
    expect(screen.queryByLabelText(/Session total token budget/)).toBeNull();
    // Sandbox
    expect(screen.getByLabelText(/Sandbox: OS-level/)).toBeDefined();
    // Routing
    expect(screen.getByLabelText(/Routing: main primary/)).toBeDefined();
    // Coordinator
    expect(screen.getByLabelText(/Coordinator enabled/)).toBeDefined();
    // AskUserQuestion
    expect(screen.getByLabelText(/AskUserQuestion max questions/)).toBeDefined();
    // Model
    expect(screen.getByLabelText(/Default model context window/)).toBeDefined();
    // Analytics / Notifications / Postgres / SSE / Bridge / Voice / DAP / ACP
    // —— 全部隐藏（上游 stub / headless 服务端件,桌面无消费面）。
    expect(screen.queryByLabelText(/Analytics OTLP endpoint/)).toBeNull();
    expect(screen.queryByLabelText(/Notifications webhook URL/)).toBeNull();
    expect(screen.queryByLabelText(/Postgres session database URL/)).toBeNull();
    expect(screen.queryByLabelText(/SSE Redis URL/)).toBeNull();
    expect(screen.queryByLabelText(/Bridge endpoint/)).toBeNull();
    expect(screen.queryByLabelText(/^Voice enabled$/)).toBeNull();
    expect(screen.queryByLabelText(/DAP adapter/)).toBeNull();
    expect(screen.queryByLabelText(/ACP bind address/)).toBeNull();
    // Sanitize
    expect(screen.getByLabelText(/Sanitize enabled/)).toBeDefined();
    // Plugins(textarea)
    expect(screen.getByLabelText(/Enabled plugins/)).toBeDefined();
  });

  it('updates theme and appearance preferences from Display settings', async () => {
    renderSettingsView();
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));

    fireEvent.click(screen.getByRole('button', { name: /Dark/ }));
    expect(getTheme()).toBe('dark');

    fireEvent.change(screen.getByRole('slider', { name: /Surface opacity/ }), {
      target: { value: '70' },
    });
    expect(getUiPrefs().surfaceOpacity).toBe(0.7);

    const url = screen.getByLabelText('Background image URL');
    fireEvent.change(url, { target: { value: 'https://example.com/wallpaper.jpg' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(getUiPrefs().backgroundImage).toBe('https://example.com/wallpaper.jpg');
  });

  it('preserves preloaded values for structured fields', async () => {
    renderSettingsView();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    // compact / token_budget 段已不进表单（压缩阈值下沉为模型组级
    // auto_compact）；预加载断言用存留的 [model].context_window。
    await waitFor(() => {
      const input = screen.getByLabelText(/Default model context window/) as HTMLInputElement;
      expect(input.value).toBe('200000');
    });
  });

  it('renders the Display screen with all primary cards (theme / transparency / background)', () => {
    const { container } = renderSettingsView();
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
    const headings = Array.from(container.querySelectorAll('h3')).map((h) => h.textContent ?? '');
    expect(headings.some((t) => t.includes('Theme'))).toBe(true);
    expect(headings.some((t) => t.includes('Transparency'))).toBe(true);
    expect(headings.some((t) => t.includes('Background image'))).toBe(true);
    // 主题色已不可自定义：分区里不再有取色器。
    expect(headings.some((t) => t.includes('Accent color'))).toBe(false);
    expect(container.querySelector('input[type="color"]')).toBeNull();
    // 三个主题模式按钮都在
    const themeButtons = Array.from(container.querySelectorAll('button')).filter((b) =>
      ['System', 'Dark', 'Light'].some((label) => (b.textContent ?? '').includes(label)),
    );
    expect(themeButtons).toHaveLength(3);
    // 至少两个 range 输入 + URL 文本框 + 文件输入
    expect(container.querySelectorAll('input[type="range"]').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('input[type="url"]')).toBeTruthy();
    expect(container.querySelector('input[type="file"]')).toBeTruthy();
  });

  it('toggles the developer-mode ActivityBar switch from Display settings', () => {
    renderSettingsView();
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
    // 默认 simple（大众模式）：开关未勾选。
    const toggle = screen.getByTestId('settings-advanced-views') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(getUiPrefs().activityBarMode).toBe('simple');

    fireEvent.click(toggle);
    expect(getUiPrefs().activityBarMode).toBe('full');
    expect((screen.getByTestId('settings-advanced-views') as HTMLInputElement).checked).toBe(true);

    fireEvent.click(toggle);
    expect(getUiPrefs().activityBarMode).toBe('simple');
  });
});

describe('configSchema helpers', () => {
  it('readField returns existing scalar values', () => {
    expect(readField(SAMPLE_TOML, 'compact', 'trigger_tokens')).toBe('1024');
    expect(readField(SAMPLE_TOML, 'hooks.search_budget', 'max_calls')).toBe('25');
  });

  it('applyField writes scalar text into existing sections', () => {
    const next = applyField(SAMPLE_TOML, 'compact', 'model_hint', 'sk-new', 'text');
    expect(next).toContain('model_hint = "sk-new"');
    expect(next).toContain('[mcp_servers.filesystem]');
  });

  it('applyField creates new sections when missing', () => {
    const next = applyField('', 'compact', 'model_hint', 'sk-new', 'text');
    expect(next).toContain('[compact]');
    expect(next).toContain('model_hint = "sk-new"');
  });

  it('applyField removes empty values from existing sections', () => {
    const next = applyField(SAMPLE_TOML, 'compact', 'trigger_tokens', '', 'text');
    expect(next).not.toContain('trigger_tokens = 1024');
    expect(next).toContain('[compact]');
  });

  it('applyField encodes boolean and integer values without quotes', () => {
    expect(applyField(SAMPLE_TOML, 'compact', 'trigger_tokens', '1024', 'integer')).toContain('trigger_tokens = 1024');
    const sandboxOn = applyField(SAMPLE_TOML, 'sandbox', 'os_level', 'true', 'boolean');
    expect(sandboxOn).toContain('os_level = true');
  });

  // 数组型字段(`Vec<String>`)必须写成 TOML **数组字面量**。
  // 此前经 `encodeScalar` 二次编码成字符串(enabled_plugins = "\"a\", \"b\"")，
  // 与后端 `Vec<String>` 不匹配 → 保存配置报校验错误。
  it('applyField writes list fields as TOML arrays (not strings)', () => {
    const next = applyField(SAMPLE_TOML, 'model_discovery', 'always_free', 'union-alpha\nbig-pickle', 'textarea');
    expect(next).toContain('always_free = ["union-alpha", "big-pickle"]');
    expect(next).not.toContain('always_free = "\\"');

    const plugins = applyField(SAMPLE_TOML, 'plugins', 'enabled_plugins', 'code-formatter@sample-tools', 'textarea');
    expect(plugins).toContain('enabled_plugins = ["code-formatter@sample-tools"]');
  });

  it('applyField removes a list field when every item is cleared', () => {
    const next = applyField(SAMPLE_TOML, 'model_discovery', 'always_free', '  \n ', 'textarea');
    expect(next).not.toContain('always_free');
  });

  it('readField returns list fields as newline-joined items', () => {
    const toml = `[model_discovery]
always_free = ["union-alpha", "big-pickle"]
free_id_patterns = ["-free", ":free"]
`;
    expect(readField(toml, 'model_discovery', 'always_free')).toBe('union-alpha\nbig-pickle');
    expect(readField(toml, 'model_discovery', 'free_id_patterns')).toBe('-free\n:free');
  });
});
