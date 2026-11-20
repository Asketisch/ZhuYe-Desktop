/**
 * BrowserView —— 受控浏览器面板切片测试。
 *
 * 验证:
 *   - 挂载即查询状态 → 无浏览器时空态引导
 *   - 启动 → 状态转为运行中 + URL 栏
 *   - zhuye_browser_frame 事件 → 帧渲染为 <img>
 *   - 停止 → 帧清空
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import { resetMockInvoke, mockInvoke, emitMockEvent } from '@/test/setup.tsx';
import { BrowserView } from './BrowserView';

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router');
  return { ...actual, Outlet: () => null, Link: () => null, useNavigate: () => () => {} };
});

describe('BrowserView', () => {
  beforeEach(() => {
    resetMockInvoke();
  });
  afterEach(() => cleanup());

  it('无运行实例 → 空态引导 + 启动按钮', async () => {
    mockInvoke('zhuye_browser_status', async () => ({
      running: false,
      url: null,
      title: null,
      streaming: false,
      message: null,
    }));
    render(<BrowserView />);
    await waitFor(() => {
      expect(screen.getByTestId('browser-empty')).toBeDefined();
    });
    expect(screen.getByTestId('browser-start')).toBeDefined();
    expect(screen.queryByTestId('browser-frame')).toBeNull();
  });

  it('启动 → 状态运行中 + URL 栏;帧事件 → 画面渲染', async () => {
    mockInvoke('zhuye_browser_status', async () => ({
      running: false,
      url: null,
      title: null,
      streaming: false,
      message: null,
    }));
    render(<BrowserView />);
    await waitFor(() => {
      expect((screen.getByTestId('browser-start') as HTMLButtonElement).disabled).toBe(false);
    });

    mockInvoke('zhuye_browser_start', async () => ({
      running: true,
      url: 'https://example.com/article',
      title: '示例页',
      streaming: true,
      message: null,
    }));
    fireEvent.click(screen.getByTestId('browser-start'));

    await waitFor(() => {
      expect(screen.getByTestId('browser-running')).toBeDefined();
    });
    expect(screen.getByTestId('browser-url').textContent).toContain('example.com');
    expect(screen.getByTestId('browser-stop')).toBeDefined();

    act(() => {
      emitMockEvent('zhuye_browser_frame', { data: 'ZmFrZWpwZWc=' });
    });
    const frame = screen.getByTestId('browser-frame') as HTMLImageElement;
    expect(frame.src).toBe('data:image/jpeg;base64,ZmFrZWpwZWc=');
  });

  it('重新打开运行中的页面时恢复最近画面', async () => {
    const running = { running: true, url: 'about:blank', title: null, streaming: true, message: null };
    mockInvoke('zhuye_browser_status', async () => running);
    mockInvoke('zhuye_browser_start', async () => { emitMockEvent('zhuye_browser_frame', { data: 'cmVwbGF5' }); return running; });
    render(<BrowserView />);
    const frame = await screen.findByTestId('browser-frame') as HTMLImageElement;
    expect(frame.src).toBe('data:image/jpeg;base64,cmVwbGF5');
  });

  it('停止 → 帧清空回空态', async () => {
    mockInvoke('zhuye_browser_status', async () => ({
      running: true,
      url: 'https://example.com',
      title: null,
      streaming: true,
      message: null,
    }));
    render(<BrowserView />);
    await waitFor(() => {
      expect(screen.getByTestId('browser-stop')).toBeDefined();
    });
    act(() => {
      emitMockEvent('zhuye_browser_frame', { data: 'ZmFrZWpwZWc=' });
    });
    expect(screen.getByTestId('browser-frame')).toBeDefined();

    mockInvoke('zhuye_browser_stop', async () => ({
      running: false,
      url: null,
      title: null,
      streaming: false,
      message: '已停止浏览器实例',
    }));
    fireEvent.click(screen.getByTestId('browser-stop'));
    await waitFor(() => {
      expect(screen.getByTestId('browser-empty')).toBeDefined();
    });
    expect(screen.queryByTestId('browser-frame')).toBeNull();
    expect(screen.getByTestId('browser-message').textContent).toContain('已停止');
  });

  it('启动失败 → 错误如实展示', async () => {
    mockInvoke('zhuye_browser_status', async () => ({
      running: false,
      url: null,
      title: null,
      streaming: false,
      message: null,
    }));
    render(<BrowserView />);
    await waitFor(() => {
      expect((screen.getByTestId('browser-start') as HTMLButtonElement).disabled).toBe(false);
    });
    mockInvoke('zhuye_browser_start', async () => {
      throw new Error('本机未找到 Chrome/Chromium/Edge');
    });
    fireEvent.click(screen.getByTestId('browser-start'));
    await waitFor(() => {
      expect(screen.getByTestId('browser-error').textContent).toContain('Chrome');
    });
  });
});
