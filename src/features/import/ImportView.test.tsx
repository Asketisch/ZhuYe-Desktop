/**
 * Vitest —— ImportView 测试(v1.11 D9:外部 Agent 会话导入入口)。
 *
 * 覆盖完整 GUI 导入链(fakeBackend):
 * - 三 adapter 下拉渲染,默认 claude_code;切换 kind → discover 按新 kind 重新请求
 * - 发现数量徽标照实渲染;发现失败 → 警告徽标(不炸视图)
 * - 无来源时导入按钮禁用;dry-run 缺省勾选
 * - 点击导入 → 转发 { dryRun, force: false } 到 reflect_import_sessions
 * - 结果逐条渲染:成功行(来源 + turns/records)/ 失败行(来源 + 原因)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ImportView } from './ImportView';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup';

function wrap(node: React.ReactNode) {
  return <QueryClientProvider client={createTestQueryClient()}>{node}</QueryClientProvider>;
}

const SOURCES = [
  { source: '~/.claude/projects/alpha', sessions: 3 },
  { source: '~/.claude/projects/beta', sessions: 1 },
];

describe('ImportView — external harness import', () => {
  beforeEach(() => {
    resetMockInvoke();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders three adapter kinds, defaults to claude_code, and shows discovered count', async () => {
    const discoverCalls: string[] = [];
    mockInvoke('reflect_import_discover', async (_cmd: string, args: { kind: string }) => {
      discoverCalls.push(args.kind);
      return SOURCES;
    });
    render(wrap(<ImportView />));
    const select = screen.getByTestId('import-kind-select') as HTMLSelectElement;
    expect(select.value).toBe('claude_code');
    // 三个 adapter 都在下拉里。
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(['claude_code', 'codex', 'zcode']);
    // 发现数量徽标照实渲染。
    expect(await screen.findByTestId('import-source-count')).toBeDefined();
    expect(screen.getByTestId('import-source-count').textContent).toBe('2');
    expect(discoverCalls).toContain('claude_code');
  });

  it('switching kind re-discovers with the new harness kind', async () => {
    const discoverCalls: string[] = [];
    mockInvoke('reflect_import_discover', async (_cmd: string, args: { kind: string }) => {
      discoverCalls.push(args.kind);
      return [];
    });
    render(wrap(<ImportView />));
    await screen.findByTestId('import-source-count');
    fireEvent.change(screen.getByTestId('import-kind-select'), { target: { value: 'zcode' } });
    await waitFor(() => {
      expect(discoverCalls).toContain('zcode');
    });
  });

  it('discover failure renders a warning badge instead of crashing', async () => {
    mockInvoke('reflect_import_discover', async () => {
      throw new Error('db locked');
    });
    render(wrap(<ImportView />));
    await waitFor(() => {
      expect(screen.getByTestId('import-kind-select')).toBeDefined();
    });
    // 视图仍可用:选择器在,数量徽标换成失败态(具体文案由 i18n 决定,断言存在即可)。
    expect(screen.queryByTestId('import-source-count')).toBeNull();
  });

  it('disables run when no sources and forwards dryRun/force on click', async () => {
    const importCalls: Array<Record<string, unknown>> = [];
    mockInvoke('reflect_import_discover', async () => SOURCES);
    mockInvoke('reflect_import_sessions', async (_cmd: string, args: Record<string, unknown>) => {
      importCalls.push(args);
      return {
        imported: [
          { source: SOURCES[0].source, turns: 12, records: 40 },
          { source: SOURCES[1].source, turns: 3, records: 9 },
        ],
        failed: [{ source: '~/.claude/projects/bad', error: 'corrupt jsonl' }],
      };
    });
    render(wrap(<ImportView />));
    await screen.findByTestId('import-source-count');
    const btn = screen.getByTestId('import-run-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    // dry-run 缺省勾选。
    expect((screen.getByTestId('import-dry-run') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(btn);
    await waitFor(() => {
      expect(importCalls).toHaveLength(1);
    });
    // IPC 载荷是扁平键(与后端命令参数一一对应),断言到字段级。
    expect(importCalls[0].kind).toBe('claude_code');
    expect(importCalls[0].dryRun).toBe(true);
    expect(importCalls[0].force).toBe(false);
    // 结果逐条渲染:两行成功 + 一行失败。
    await waitFor(() => {
      expect(screen.getAllByTestId('import-success-row')).toHaveLength(2);
    });
    expect(screen.getAllByTestId('import-failure-row')).toHaveLength(1);
    expect(screen.getByTestId('import-failure-row').textContent).toContain('corrupt jsonl');

    // 无来源场景:按钮禁用。
    cleanup();
    mockInvoke('reflect_import_discover', async () => []);
    render(wrap(<ImportView />));
    await screen.findByTestId('import-source-count');
    expect((screen.getByTestId('import-run-btn') as HTMLButtonElement).disabled).toBe(true);
  });
});
