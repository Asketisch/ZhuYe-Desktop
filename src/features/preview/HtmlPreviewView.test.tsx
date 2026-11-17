/**
 * Vitest —— HtmlPreviewView 测试(v1.11 D1 轻版:HTML 产物预览)。
 *
 * 覆盖:
 * - 路径输入 + 打开按钮 / Enter 提交 → reflect_read_file 转发该路径
 * - HTML 内容经 iframe srcDoc 渲染(沙箱:不执行脚本)
 * - 非 .html 文件 → 原文兜底块(pre,截断 4000 字符口径)
 * - 读失败 → 警告徽标(不炸视图);空输入禁用打开按钮
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { HtmlPreviewView } from './HtmlPreviewView';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup';

function wrap(node: React.ReactNode) {
  return <QueryClientProvider client={createTestQueryClient()}>{node}</QueryClientProvider>;
}

describe('HtmlPreviewView — html artifact preview', () => {
  beforeEach(() => {
    resetMockInvoke();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('forwards the submitted path to reflect_read_file and renders srcDoc iframe', async () => {
    const reads: string[] = [];
    mockInvoke('reflect_read_file', async (_cmd: string, args: { path: string }) => {
      reads.push(args.path);
      return { content: '<h1>agent-made page</h1>', truncated: false };
    });
    render(wrap(<HtmlPreviewView />));
    const input = screen.getByTestId('preview-path-input');
    const btn = screen.getByTestId('preview-open-btn') as HTMLButtonElement;
    // 空输入 → 禁用。
    expect(btn.disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'dist/index.html' } });
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => {
      expect(reads).toEqual(['dist/index.html']);
    });
    const frame = await screen.findByTestId('preview-frame') as HTMLIFrameElement;
    expect(frame.srcdoc).toContain('agent-made page');
    // 静态预览口径:sandbox 属性禁止脚本执行。
    expect(frame.getAttribute('sandbox')).toBe('');
  });

  it('Enter key submits the path without clicking the button', async () => {
    const reads: string[] = [];
    mockInvoke('reflect_read_file', async (_cmd: string, args: { path: string }) => {
      reads.push(args.path);
      return { content: '<p>x</p>', truncated: false };
    });
    render(wrap(<HtmlPreviewView />));
    fireEvent.change(screen.getByTestId('preview-path-input'), {
      target: { value: 'out/report.html' },
    });
    fireEvent.keyDown(screen.getByTestId('preview-path-input'), { key: 'Enter' });
    await waitFor(() => {
      expect(reads).toEqual(['out/report.html']);
    });
  });

  it('non-html files fall back to a raw pre block', async () => {
    mockInvoke('reflect_read_file', async () => ({
      content: 'plain text artifact body',
      truncated: false,
    }));
    render(wrap(<HtmlPreviewView />));
    fireEvent.change(screen.getByTestId('preview-path-input'), {
      target: { value: 'notes.txt' },
    });
    fireEvent.click(screen.getByTestId('preview-open-btn'));
    await waitFor(() => {
      expect(screen.getByText(/plain text artifact body/)).toBeDefined();
    });
  });

  it('read failure shows a warning badge and keeps the view usable', async () => {
    mockInvoke('reflect_read_file', async () => {
      throw new Error('path escapes workspace');
    });
    render(wrap(<HtmlPreviewView />));
    fireEvent.change(screen.getByTestId('preview-path-input'), {
      target: { value: '../outside.html' },
    });
    fireEvent.click(screen.getByTestId('preview-open-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('preview-error')).toBeDefined();
    });
    // 视图仍可用:可改路径重试。
    expect((screen.getByTestId('preview-open-btn') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('LivePorts (F50 live 端口自动发现)', () => {
  it('renders open ports as clickable external links', async () => {
    mockInvoke('reflect_scan_local_ports', async () => [
      { port: 5173, open: true, url: 'http://127.0.0.1:5173' },
      { port: 8080, open: false, url: 'http://127.0.0.1:8080' },
    ]);
    render(wrap(<HtmlPreviewView />));
    const link = await screen.findByTestId('preview-live-5173');
    expect(link).toBeDefined();
    expect(link.getAttribute('href')).toBe('http://127.0.0.1:5173');
    expect(screen.queryByTestId('preview-live-8080')).toBeNull();
  });

  it('shows none placeholder when all ports closed', async () => {
    mockInvoke('reflect_scan_local_ports', async () => [
      { port: 8080, open: false, url: 'http://127.0.0.1:8080' },
    ]);
    render(wrap(<HtmlPreviewView />));
    // 全关闭:容器仍在(功能可发现),但不渲染端口链接。
    await screen.findByTestId('preview-live-ports');
    expect(screen.queryByTestId('preview-live-8080')).toBeNull();
    expect(screen.getByText(/常用 dev 端口|common dev/)).toBeDefined();
  });
});
