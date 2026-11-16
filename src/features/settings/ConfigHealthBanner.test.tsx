/**
 * Vitest — F50 ConfigHealthBanner(纯函数派生 + 渲染 + dismiss)。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ConfigHealthBanner, deriveConfigIssues } from './ConfigHealthBanner';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup.tsx';

function wrap(node: React.ReactNode) {
  return <QueryClientProvider client={createTestQueryClient()}>{node}</QueryClientProvider>;
}

const HEALTHY_TOML = `
[active]
provider = "anthropic"
[anthropic]
api_key = "sk-ant-test"
[sandbox]
os_level = true
`;

const NO_PROVIDER_TOML = `
[anthropic]
api_key = ""
`;

const GUARD_OFF_TOML = `
[active]
provider = "anthropic"
[prompt_guard]
enabled = false
`;

describe('deriveConfigIssues(纯函数)', () => {
  it('healthy config → no issues', () => {
    expect(deriveConfigIssues(HEALTHY_TOML)).toEqual([]);
  });

  it('no provider + no api keys → critical', () => {
    const issues = deriveConfigIssues(NO_PROVIDER_TOML);
    const critical = issues.find((i) => i.key === 'no-provider');
    expect(critical?.level).toBe('critical');
    expect(critical?.message).toContain('provider');
  });

  it('prompt_guard explicitly disabled → warn', () => {
    const issues = deriveConfigIssues(GUARD_OFF_TOML);
    const warn = issues.find((i) => i.key === 'guard-disabled');
    expect(warn?.level).toBe('warn');
    expect(warn?.message).toContain('注入防护');
  });

  it('guard unset → no warning (F01 默认开启,不提示)', () => {
    expect(deriveConfigIssues(HEALTHY_TOML).find((i) => i.key === 'guard-disabled')).toBeUndefined();
  });

  it('sandbox off → warn', () => {
    const issues = deriveConfigIssues(`
[active]
provider = "anthropic"
[sandbox]
os_level = false
`);
    expect(issues.find((i) => i.key === 'sandbox-off')?.level).toBe('warn');
  });
});

describe('ConfigHealthBanner 组件', () => {
  beforeEach(() => {
    resetMockInvoke();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders critical issue for missing provider', async () => {
    mockInvoke('reflect_get_config', async () => NO_PROVIDER_TOML);
    render(wrap(<ConfigHealthBanner />));
    await waitFor(() => expect(screen.getByTestId('config-issue-no-provider')).toBeDefined());
    expect(screen.getByText(/无法开始对话/)).toBeDefined();
  });

  it('hidden for healthy config', async () => {
    mockInvoke('reflect_get_config', async () => HEALTHY_TOML);
    render(wrap(<ConfigHealthBanner />));
    await waitFor(() => expect(screen.queryByTestId('config-health-banner')).toBeNull());
  });

  it('dismiss per issue key', async () => {
    mockInvoke('reflect_get_config', async () => GUARD_OFF_TOML);
    render(wrap(<ConfigHealthBanner />));
    await waitFor(() => expect(screen.getByTestId('config-issue-guard-disabled')).toBeDefined());
    // GUARD_OFF_TOML 同时触发 sandbox-off(未配置段)—— 两行各有 dismiss。
    // 这里只关第一行,验证 dismiss 按 issue key 生效(另一行仍在)。
    const row = screen.getByTestId('config-issue-guard-disabled');
    fireEvent.click(row.querySelector('button')!);
    await waitFor(() => expect(screen.queryByTestId('config-issue-guard-disabled')).toBeNull());
    expect(screen.getByTestId('config-issue-sandbox-off')).toBeDefined();
  });
});
