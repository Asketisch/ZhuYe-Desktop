/**
 * BrowserDock —— 右 dock「浏览器」面板切片测试。
 *
 * 验证(mockInvoke 模式,后端为模拟):
 *   - 状态 running=false → 空态引导 + 启动按钮(无画面、无停止键)
 *   - 点击启动 → zhuye_browser_start 被调 → 转运行态(地址栏 + 停止键)
 *   - 地址栏输入 + Enter → zhuye_browser_navigate 收到 trim 后的地址
 *     (scheme 补全在后端 normalize_url,不在前端重复)
 *   - 设备档位 → zhuye_browser_set_device 收到预设尺寸
 *   - zhuye_browser_frame 事件 → 画面渲染为 <img>
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import { resetMockInvoke, mockInvoke, emitMockEvent } from '@/test/setup.tsx';
import { BrowserDock } from './BrowserDock';

const NOT_RUNNING = {
  running: false,
  url: null,
  title: null,
  streaming: false,
  message: null,
};

const RUNNING = {
  running: true,
  url: 'about:blank',
  title: null,
  streaming: true,
  message: null,
};

describe('BrowserDock', () => {
  beforeEach(() => {
    resetMockInvoke();
  });
  afterEach(() => cleanup());

  it('未启动 → 空态引导 + 启动按钮;无画面与停止键', async () => {
    mockInvoke('zhuye_browser_status', async () => NOT_RUNNING);
    render(<BrowserDock />);
    await waitFor(() => {
      expect(screen.getByTestId('browser-dock-empty')).toBeDefined();
    });
    expect(screen.getByTestId('browser-dock-start')).toBeDefined();
    expect(screen.queryByTestId('browser-dock-frame')).toBeNull();
    expect(screen.queryByTestId('browser-dock-stop')).toBeNull();
    // 导航三键未启动时禁用。
    expect((screen.getByTestId('browser-dock-back') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('browser-dock-url').querySelector('input') as HTMLInputElement).disabled).toBe(true);
  });

  it('启动 → zhuye_browser_start 被调,转运行态(地址栏 + 停止键)', async () => {
    mockInvoke('zhuye_browser_status', async () => NOT_RUNNING);
    render(<BrowserDock />);
    await waitFor(() => {
      expect(screen.getByTestId('browser-dock-start')).toBeDefined();
    });

    const start = vi.fn(async () => RUNNING);
    mockInvoke('zhuye_browser_start', start);
    fireEvent.click(screen.getByTestId('browser-dock-start'));

    await waitFor(() => {
      expect(screen.getByTestId('browser-dock-stop')).toBeDefined();
    });
    expect(start).toHaveBeenCalledTimes(1);
    // 地址栏草稿随 status.url 同步( effect 在状态提交后落帧,等待到位)。
    await waitFor(() => {
      expect((screen.getByTestId('browser-dock-url').querySelector('input') as HTMLInputElement).value).toBe('about:blank');
    });
  });

  it('地址栏 Enter → zhuye_browser_navigate 收到 trim 后的地址', async () => {
    mockInvoke('zhuye_browser_status', async () => RUNNING);
    render(<BrowserDock />);
    await waitFor(() => {
      expect((screen.getByTestId('browser-dock-url').querySelector('input') as HTMLInputElement).value).toBe('about:blank');
    });

    const navigate = vi.fn(async (_cmd: string, _args?: { url?: string }) => ({
      running: true,
      url: 'https://example.com/',
      title: null,
      streaming: true,
      message: null,
    }));
    mockInvoke('zhuye_browser_navigate', navigate);
    const input = screen.getByTestId('browser-dock-url').querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  example.com  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledTimes(1);
    });
    // 前端只 trim;scheme 补全归后端 normalize_url。
    expect(navigate.mock.calls[0][1]).toEqual({ url: 'example.com' });
  });

  it('设备档位 → zhuye_browser_set_device 收到预设尺寸', async () => {
    mockInvoke('zhuye_browser_status', async () => RUNNING);
    render(<BrowserDock />);
    await waitFor(() => {
      expect(screen.getByTestId('browser-dock-device-phone')).toBeDefined();
    });

    const setDevice = vi.fn(async (_cmd: string, _args?: { width?: number; height?: number }) => RUNNING);
    mockInvoke('zhuye_browser_set_device', setDevice);
    fireEvent.click(screen.getByTestId('browser-dock-device-phone'));

    await waitFor(() => {
      expect(setDevice).toHaveBeenCalledTimes(1);
    });
    expect(setDevice.mock.calls[0][1]).toEqual({ width: 390, height: 844 });
    // 档位即时高亮(本地状态)。
    expect(screen.getByTestId('browser-dock-device-phone').className).toContain('on');
  });

  it('运行中帧事件 → 画面渲染为 <img>(等比缩放)', async () => {
    mockInvoke('zhuye_browser_status', async () => RUNNING);
    render(<BrowserDock />);
    await waitFor(() => {
      expect(screen.getByTestId('browser-dock-stop')).toBeDefined();
    });
    expect(screen.getByTestId('browser-dock-waiting')).toBeDefined();

    act(() => {
      emitMockEvent('zhuye_browser_frame', { data: 'ZmFrZWpwZWc=' });
    });
    const frame = screen.getByTestId('browser-dock-frame') as HTMLImageElement;
    expect(frame.src).toBe('data:image/jpeg;base64,ZmFrZWpwZWc=');
  });
});
