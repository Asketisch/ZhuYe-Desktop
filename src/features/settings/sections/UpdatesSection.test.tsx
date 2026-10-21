/**
 * UpdatesSection —— 更新检查界面测试。
 *
 * 验证：
 *   - 初始不显示结果(未探测)
 *   - 点「检查更新」后调用 reflect_check_update
 *   - 有新版 → 显示版本徽标 + 发布说明 + 发布页链接
 *   - 探测出错 → 如实展示错误,不静默
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { resetMockInvoke, mockInvoke } from '@/test/setup.tsx';
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
    mockInvoke('reflect_check_update', async () => ({
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
    mockInvoke('reflect_check_update', async () => ({
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
    mockInvoke('reflect_check_update', async () => ({
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
    mockInvoke('reflect_check_update', async () => {
      throw new Error('bridge down');
    });
    render(<UpdatesSection />);
    fireEvent.click(screen.getByTestId('updates-check'));

    await waitFor(() => {
      expect(screen.getByTestId('updates-error').textContent).toContain('bridge down');
    });
  });
});
