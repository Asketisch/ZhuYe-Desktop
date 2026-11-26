import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ConfigHealthBanner } from './ConfigHealthBanner';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup.tsx';
import type { ConfigHealthIssue } from '@/utils/commands/runtimeStatus';

function wrap(node: React.ReactNode) {
  return <QueryClientProvider client={createTestQueryClient()}>{node}</QueryClientProvider>;
}

function setIssues(issues: ConfigHealthIssue[]) {
  mockInvoke('zhuye_config_info', async () => ({ issues }));
}

describe('配置健康提示', () => {
  beforeEach(() => resetMockInvoke());
  afterEach(() => cleanup());

  it('显示后端返回的问题及翻译', async () => {
    setIssues([{ key: 'no-provider', level: 'critical' }]);
    render(wrap(<ConfigHealthBanner />));
    expect(await screen.findByTestId('config-issue-no-provider')).toBeDefined();
    expect(screen.getByText(/No model provider is configured/)).toBeDefined();
  });

  it('健康配置没有问题行，仍可运行探活', async () => {
    setIssues([]);
    render(wrap(<ConfigHealthBanner />));
    await screen.findByTestId('config-drill');
    expect(screen.queryByTestId('config-issue-no-provider')).toBeNull();
  });

  it('按标识单独关闭问题', async () => {
    setIssues([{ key: 'guard-disabled', level: 'warn' }, { key: 'sandbox-off', level: 'warn' }]);
    render(wrap(<ConfigHealthBanner />));
    const row = await screen.findByTestId('config-issue-guard-disabled');
    fireEvent.click(row.querySelector('button')!);
    expect(screen.queryByTestId('config-issue-guard-disabled')).toBeNull();
    expect(screen.getByTestId('config-issue-sandbox-off')).toBeDefined();
  });

  it('探活分别检查后端与配置读取', async () => {
    setIssues([]);
    const calls: string[] = [];
    mockInvoke('ping', async () => { calls.push('ping'); return { msg: 'ok', version: '1' }; });
    mockInvoke('zhuye_get_config', async () => { calls.push('config'); return ''; });
    render(wrap(<ConfigHealthBanner />));
    await screen.findByTestId('config-drill');
    fireEvent.click(screen.getByText(/Run drill|运行探活/i));
    await waitFor(() => expect(calls).toEqual(['ping', 'config']));
    expect(screen.getByTestId('config-drill-results').textContent).toContain('backend: ok');
  });
});
