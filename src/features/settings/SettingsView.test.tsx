/**
 * Vitest — SettingsView 组件测试(阶段 4:真实 config 持久化)。
 *
 * 验证:
 * 1. 渲染 Provider / Permissions / Advanced sections
 * 2. 显示 agent 状态徽标(从 reflect_agent_status)
 * 3. permission 按钮点击调 reflect_set_permission_mode
 * 4. Save 按钮调 reflect_save_config
 * 5. 全量结构化表单为所有 ReflectConfig 段提供直接输入框
 * 6. Ollama / Anthropic / OpenAI provider 都有显式输入
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
provider = "anthropic"

[anthropic]
api_key = "sk-ant-existing"
model = "claude-3-5-sonnet-latest"

[openai]
api_key = "sk-existing"
model = "gpt-4o"

[mcp_servers.filesystem]
type = "stdio"
command = "npx"

[hooks.search_budget]
max_calls = 25
`;

describe('SettingsView', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('reflect.locale', 'en');
    resetUiPrefsForTests();
    resetMockInvoke();
    mockInvoke('reflect_set_permission_mode', async () => {});
    mockInvoke('reflect_save_config', async () => {});
    mockInvoke('reflect_get_config', async () => SAMPLE_TOML);
    mockInvoke('reflect_agent_status', async () => ({
      ready: true,
      has_model: true,
      model: 'anthropic/claude-3-5-sonnet-latest',
      workspace: '/tmp',
      degraded_reason: null,
    }));
  });
  afterEach(() => cleanup());

  it('renders Provider / Permissions / Advanced sections', async () => {
    renderSettingsView();
    expect(screen.getByText('Settings')).toBeDefined();
    // nav + section 都有同名标题，用 getAllByText。
    expect(screen.getAllByText('Provider').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Permissions').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Advanced/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows agent ready status badge when has_model', async () => {
    renderSettingsView();
    await waitFor(() => {
      expect(screen.getByText(/Agent ready/)).toBeDefined();
    });
  });

  it('clicking permission button calls reflect_set_permission_mode', async () => {
    let modeArg: string | null = null;
    mockInvoke('reflect_set_permission_mode', async (_cmd: string, args: unknown) => {
      modeArg = (args as { mode: string }).mode;
    });

    renderSettingsView();
    // 权限快捷控件只在 Permissions 页显示（不再每个设置页签重复）。
    fireEvent.click(screen.getByText('Permissions'));
    // permission 按钮文案:auto/prompt/deny/plan。
    const planBtn = await screen.findByText('plan', { selector: 'button' });
    fireEvent.click(planBtn);

    await waitFor(() => expect(modeArg).toBe('plan'), { timeout: 2000 });
  });

  it('preserves edits made while a save is in flight and config refetches', async () => {
    let finish!: () => void;
    let saved = SAMPLE_TOML;
    let reads = 0;
    mockInvoke('reflect_save_config', async (_cmd, args) => {
      const submitted = (args as { toml: string }).toml;
      await new Promise<void>((resolve) => { finish = resolve; });
      saved = submitted;
    });
    mockInvoke('reflect_get_config', async () => { reads += 1; return saved; });
    renderSettingsView();
    fireEvent.click(screen.getByText('Advanced'));
    const editor = await screen.findByRole('textbox') as HTMLTextAreaElement;
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

  it('Save button calls reflect_save_config with merged TOML', async () => {
    let savedToml: string | null = null;
    mockInvoke('reflect_save_config', async (_cmd: string, args: unknown) => {
      savedToml = (args as { toml: string }).toml;
    });

    renderSettingsView();
    // 等 config 加载完成(状态徽标出现 = get_config + agent_status 都 resolve)。
    await waitFor(() => {
      expect(screen.getByText(/Agent ready/)).toBeDefined();
    });
    // 再等一帧让 useEffect 把 rawToml 写入。
    await waitFor(() => {
      expect(screen.getByText('Save to ~/.zhuye/config.toml')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Save to ~/.zhuye/config.toml'));
    await waitFor(() => expect(savedToml).not.toBeNull(), { timeout: 2000 });
    // 合并后的 TOML 应保留 active + anthropic 段(SAMPLE_TOML 的内容)。
    expect(savedToml).toContain('[active]');
    expect(savedToml).toContain('provider = "anthropic"');
    expect(savedToml).toContain('[anthropic]');
    expect(savedToml).toContain('sk-ant-existing');
  });

  it('renders direct structured inputs for every ReflectConfig section', async () => {
    renderSettingsView();
    // Anthropic
    expect(screen.getByLabelText(/Anthropic API key/)).toBeDefined();
    expect(screen.getByLabelText(/Anthropic model/)).toBeDefined();
    // OpenAI
    expect(screen.getByLabelText(/OpenAI API key/)).toBeDefined();
    expect(screen.getByLabelText(/OpenAI model/)).toBeDefined();
    // active provider 下拉(渲染在结构化表单内;仅 anthropic / openai 两种接入端口)
    const providerSelects = screen.getAllByLabelText(/^Active provider$/);
    expect(providerSelects.length).toBeGreaterThanOrEqual(1);
    // Compact / token_budget
    expect(screen.getByLabelText(/Compact trigger tokens/)).toBeDefined();
    expect(screen.getByLabelText(/Session total token budget/)).toBeDefined();
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
    expect(screen.getByLabelText(/Analytics OTLP endpoint/)).toBeDefined();
    expect(screen.getByLabelText(/Notifications webhook URL/)).toBeDefined();
    expect(screen.getByLabelText(/Postgres session database URL/)).toBeDefined();
    expect(screen.getByLabelText(/SSE Redis URL/)).toBeDefined();
    expect(screen.getByLabelText(/Bridge endpoint/)).toBeDefined();
    expect(screen.getByLabelText(/^Voice enabled$/)).toBeDefined();
    expect(screen.getByLabelText(/DAP adapter/)).toBeDefined();
    expect(screen.getByLabelText(/ACP bind address/)).toBeDefined();
    // Sanitize
    expect(screen.getByLabelText(/Sanitize enabled/)).toBeDefined();
    // Plugins(textarea)
    expect(screen.getByLabelText(/Enabled plugins/)).toBeDefined();
  });

  it('updates theme and appearance preferences from Display settings', async () => {
    renderSettingsView();
    fireEvent.click(screen.getByRole('button', { name: 'Display' }));

    fireEvent.click(screen.getByRole('button', { name: /Dark/ }));
    expect(getTheme()).toBe('dark');

    fireEvent.change(screen.getByLabelText('Custom accent color'), {
      target: { value: '#60a5fa' },
    });
    expect(getUiPrefs().accentColor).toBe('#60a5fa');

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
    await waitFor(() => {
      const input = screen.getByLabelText(/Anthropic API key/) as HTMLInputElement;
      expect(input.value).toBe('sk-ant-existing');
    });
    const openaiKey = screen.getByLabelText(/OpenAI API key/) as HTMLInputElement;
    expect(openaiKey.value).toBe('sk-existing');
  });

  it('renders the Display screen with all four primary cards (theme / accent / transparency / background)', () => {
    const { container } = renderSettingsView();
    fireEvent.click(screen.getByRole('button', { name: 'Display' }));
    const headings = Array.from(container.querySelectorAll('h3')).map((h) => h.textContent ?? '');
    expect(headings.some((t) => t.includes('Theme'))).toBe(true);
    expect(headings.some((t) => t.includes('Accent color'))).toBe(true);
    expect(headings.some((t) => t.includes('Transparency'))).toBe(true);
    expect(headings.some((t) => t.includes('Background image'))).toBe(true);
    // 三个主题模式按钮都在
    const themeButtons = Array.from(container.querySelectorAll('button')).filter((b) =>
      ['System', 'Dark', 'Light'].some((label) => (b.textContent ?? '').includes(label)),
    );
    expect(themeButtons).toHaveLength(3);
    // 6 个以上 accent 预设 + 取色输入 + 至少两个 range 输入 + URL 文本框 + 文件输入
    const swatches = container.querySelectorAll('button[aria-label^="#"]');
    expect(swatches.length).toBeGreaterThanOrEqual(6);
    expect(container.querySelector('input[type="color"]')).toBeTruthy();
    expect(container.querySelectorAll('input[type="range"]').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('input[type="url"]')).toBeTruthy();
    expect(container.querySelector('input[type="file"]')).toBeTruthy();
  });

  it('toggles the developer-mode ActivityBar switch from Display settings', () => {
    renderSettingsView();
    fireEvent.click(screen.getByRole('button', { name: 'Display' }));
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
    expect(readField(SAMPLE_TOML, 'anthropic', 'api_key')).toBe('sk-ant-existing');
    expect(readField(SAMPLE_TOML, 'openai', 'model')).toBe('gpt-4o');
    expect(readField(SAMPLE_TOML, 'hooks.search_budget', 'max_calls')).toBe('25');
  });

  it('applyField writes scalar text into existing sections', () => {
    const next = applyField(SAMPLE_TOML, 'anthropic', 'api_key', 'sk-new', 'text');
    expect(next).toContain('api_key = "sk-new"');
    expect(next).toContain('[mcp_servers.filesystem]');
  });

  it('applyField creates new sections when missing', () => {
    const next = applyField('', 'anthropic', 'api_key', 'sk-new', 'text');
    expect(next).toContain('[anthropic]');
    expect(next).toContain('api_key = "sk-new"');
  });

  it('applyField removes empty values from existing sections', () => {
    const next = applyField(SAMPLE_TOML, 'anthropic', 'api_key', '', 'text');
    expect(next).not.toContain('api_key = "sk-ant-existing"');
    expect(next).toContain('[anthropic]');
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
