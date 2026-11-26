/**
 * UpdatesSection —— 更新检查界面测试。
 *
 * 验证：
 *   - 初始不显示结果(未探测)
 *   - 点「检查更新」后调用 zhuye_check_update
 *   - 有新版 → 显示版本徽标 + 发布说明 + 发布页链接
 *   - 探测出错 → 如实展示错误,不静默
 *   - OTA 自更新:点击安装 → 进度事件驱动进度条 → 完成出现重启按钮
 *   - 安装失败 → 如实展示,不影响检查区
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import { resetMockInvoke, mockInvoke, emitMockEvent } from '@/test/setup.tsx';
import { UpdatesSection } from './UpdatesSection';

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router');
  return { ...actual, Outlet: () => null, Link: () => null, useNavigate: () => () => {} };
});

describe('UpdatesSection', () => {
  beforeEach(() => {
    resetMockInvoke();
  });
  afterEach(() => cleanup());

  it('初始不显示任何探测结果', () => {
    render(<UpdatesSection />);
    expect(screen.getByTestId('settings-updates')).toBeDefined();
    expect(screen.queryByTestId('updates-current')).toBeNull();
    expect(screen.queryByTestId('updates-error')).toBeNull();
  });

  it('已是最新 → 显示当前版本与「已是最新」徽标', async () => {
    mockInvoke('zhuye_check_update', async () => ({
      currentVersion: '0.1.0',
      latestVersion: '0.1.0',
      updateAvailable: false,
      releaseUrl: null,
      releaseNotes: null,
      probedAt: 1,
      error: null,
    }));
    render(<UpdatesSection />);
    fireEvent.click(screen.getByTestId('updates-check'));

    await waitFor(() => {
      expect(screen.getByTestId('updates-current').textContent).toContain('0.1.0');
    });
    expect(screen.getByTestId('settings-updates').textContent).toContain('up to date');
    expect(screen.queryByTestId('updates-available')).toBeNull();
  });

  it('有新版 → 显示版本号、发布说明与发布页链接', async () => {
    mockInvoke('zhuye_check_update', async () => ({
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      updateAvailable: true,
      releaseUrl: 'https://example.invalid/releases/v0.2.0',
      releaseNotes: '- 新东西',
      probedAt: 1,
      error: null,
    }));
    render(<UpdatesSection />);
    fireEvent.click(screen.getByTestId('updates-check'));

    await waitFor(() => {
      expect(screen.getByTestId('updates-available')).toBeDefined();
    });
    // 版本号在卡片头部徽标上。
    expect(screen.getByTestId('settings-updates').textContent).toContain('0.2.0');
    const panel = screen.getByTestId('updates-available');
    expect(panel.textContent).toContain('新东西');
    const link = panel.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.invalid/releases/v0.2.0');
  });

  it('探测失败 → 如实展示错误', async () => {
    mockInvoke('zhuye_check_update', async () => ({
      currentVersion: '0.1.0',
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
      releaseNotes: null,
      probedAt: 1,
      error: 'release probe failed: offline',
    }));
    render(<UpdatesSection />);
    fireEvent.click(screen.getByTestId('updates-check'));

    await waitFor(() => {
      expect(screen.getByTestId('updates-error').textContent).toContain('offline');
    });
    expect(screen.getByTestId('settings-updates').textContent).toContain('probe failed');
  });

  it('invoke 抛错 → 同样如实展示,而不是崩掉', async () => {
    mockInvoke('zhuye_check_update', async () => {
      throw new Error('bridge down');
    });
    render(<UpdatesSection />);
    fireEvent.click(screen.getByTestId('updates-check'));

    await waitFor(() => {
      expect(screen.getByTestId('updates-error').textContent).toContain('bridge down');
    });
  });

  // ====== OTA 自更新(下载 → 校验 → 安装 → 重启) ======

  /** 探测一个有新版的 update info,为安装流测试铺底。 */
  function mockUpdateAvailable() {
    mockInvoke('zhuye_check_update', async () => ({
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      updateAvailable: true,
      releaseUrl: null,
      releaseNotes: null,
      probedAt: 1,
      error: null,
    }));
  }

  it('有新版 → 出现「立即更新」;已是最新结果 → 安装区收起', async () => {
    mockUpdateAvailable();
    render(<UpdatesSection />);
    fireEvent.click(screen.getByTestId('updates-check'));
    await waitFor(() => {
      expect(screen.getByTestId('updates-install')).toBeDefined();
    });
    expect(screen.getByTestId('updates-install-start')).toBeDefined();

    // 已是最新(installed=false)→ 收起安装区并刷新检查结果。
    mockInvoke('zhuye_download_install_update', async () => ({
      installed: false,
      version: null,
      notes: null,
    }));
    fireEvent.click(screen.getByTestId('updates-install-start'));
    await waitFor(() => {
      expect(screen.queryByTestId('updates-install-start')).toBeNull();
    });
  });

  it('安装全回路:进度事件驱动进度条 → 完成 → 重启按钮触发 relaunch', async () => {
    mockUpdateAvailable();
    render(<UpdatesSection />);
    fireEvent.click(screen.getByTestId('updates-check'));
    await waitFor(() => {
      expect(screen.getByTestId('updates-install-start')).toBeDefined();
    });

    let relaunchCalls = 0;
    mockInvoke('zhuye_relaunch_app', async () => {
      relaunchCalls += 1;
      return undefined;
    });
    mockInvoke('zhuye_download_install_update', async () => {
      act(() => {
        emitMockEvent('zhuye_update_progress', { type: 'started' });
        emitMockEvent('zhuye_update_progress', { type: 'progress', downloaded: 50, total: 100 });
      });
      await waitFor(() => {
        expect(screen.getByTestId('updates-install-progress').textContent).toContain('50');
      });
      act(() => {
        emitMockEvent('zhuye_update_progress', { type: 'finished' });
      });
      return { installed: true, version: '0.2.0', notes: null };
    });
    fireEvent.click(screen.getByTestId('updates-install-start'));

    await waitFor(() => {
      expect(screen.getByTestId('updates-install-done')).toBeDefined();
    });
    expect(screen.getByTestId('updates-install-done').textContent).toContain('0.2.0');
    fireEvent.click(screen.getByTestId('updates-relaunch'));
    expect(relaunchCalls).toBe(1);
  });

  it('安装失败 → 展示错误,检查区不受影响', async () => {
    mockUpdateAvailable();
    render(<UpdatesSection />);
    fireEvent.click(screen.getByTestId('updates-check'));
    await waitFor(() => {
      expect(screen.getByTestId('updates-install-start')).toBeDefined();
    });

    mockInvoke('zhuye_download_install_update', async () => {
      throw new Error('updater check failed: offline');
    });
    fireEvent.click(screen.getByTestId('updates-install-start'));
    await waitFor(() => {
      expect(screen.getByTestId('updates-install-error').textContent).toContain('offline');
    });
  });
});
