/**
 * Vitest —— RemoteView（Phase 2 条目 2）。
 *
 * 基于模拟 IPC 的冒烟 + 行为测试：
 *   - 页面标题 + 5 张卡片渲染
 *   - iOS 设置卡片：config.isReady 时显示就绪徽标，点击打开表单
 *   - 表单 Save 转发到 reflect_update_remote_config
 *   - Tailscale 卡片渲染检测到的状态字段
 *   - 守护进程提示卡片渲染预览文本
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RemoteView } from './RemoteView';
import { createTestQueryClient, resetMockInvoke } from '@/test/setup';

const calls: Array<{ cmd: string; args: unknown }> = [];

vi.mock('@/utils/commands', async () => {
  const actual = await vi.importActual<typeof import('@/utils/commands')>('@/utils/commands');
  return {
    ...actual,
    reflect_get_remote_config: vi.fn(async () => {
      calls.push({ cmd: 'reflect_get_remote_config', args: undefined });
      return {
        host: 'node.tail.net',
        port: 4732,
        authToken: 'topsecret',
        autoConnect: false,
        endpoint: 'node.tail.net:4732',
        isReady: true,
      };
    }),
    reflect_update_remote_config: vi.fn(async (args: Record<string, unknown>) => {
      calls.push({ cmd: 'reflect_update_remote_config', args });
      return {
        host: (args.host as string) ?? '',
        port: (args.port as number) ?? 4732,
        authToken: (args.authToken as string | null) ?? null,
        autoConnect: (args.autoConnect as boolean) ?? false,
        endpoint: `${(args.host as string) ?? ''}:${(args.port as number) ?? 4732}`,
        isReady: true,
      };
    }),
    reflect_get_remote_status: vi.fn(async () => ({
      state: 'disconnected',
      message: 'remote transport driver not yet implemented (Phase 2 follow-up)',
      endpoint: null,
      sinceMs: 100,
    })),
    reflect_tailscale_status: vi.fn(async () => ({
      installed: true,
      running: true,
      version: '1.78.0',
      dnsName: 'node.tail.net',
      hostName: 'node',
      tailnetName: 'tail.net',
      ipv4: ['100.64.0.1'],
      ipv6: [],
      suggestedRemoteHost: 'node.tail.net:4732',
      message: null,
    })),
    reflect_tailscale_daemon_command_preview: vi.fn(async () =>
      'tailscaled --tun=userspace-networking &\nlisten 0.0.0.0:4732',
    ),
    reflect_tailscale_daemon_start: vi.fn(async () => 'not implemented yet (Phase 2 follow-up)'),
    reflect_tailscale_daemon_stop: vi.fn(async () => 'not implemented yet (Phase 2 follow-up)'),
    reflect_tailscale_daemon_status: vi.fn(async () => 'not implemented yet (Phase 2 follow-up)'),
    // v1.11 基建#12:远程网页访问状态服务器。
    reflect_status_server_start: vi.fn(async (port?: number) => {
      calls.push({ cmd: 'reflect_status_server_start', args: { port: port ?? null } });
      return port ?? 4732;
    }),
    reflect_status_server_state: vi.fn(async () => null),
    reflect_status_server_stop: vi.fn(async () => {
      calls.push({ cmd: 'reflect_status_server_stop', args: undefined });
      return undefined;
    }),
  };
});

function wrap(node: React.ReactNode) {
  return <QueryClientProvider client={createTestQueryClient()}>{node}</QueryClientProvider>;
}

describe('RemoteView', () => {
  beforeEach(() => {
    cleanup();
    calls.length = 0;
    resetMockInvoke();
  });

  it('renders the page title and the five cards', async () => {
    render(wrap(<RemoteView />));
    expect(screen.getByText('Remote')).toBeDefined();
    await waitFor(() => {
      expect(screen.getByTestId('remote-config-card')).toBeDefined();
      expect(screen.getByTestId('remote-tailscale-card')).toBeDefined();
      expect(screen.getByTestId('remote-status-server-card')).toBeDefined();
      expect(screen.getByTestId('remote-daemon-card')).toBeDefined();
      expect(screen.getByTestId('remote-status-card')).toBeDefined();
    });
  });

  it('shows the ready badge + endpoint when config isReady', async () => {
    render(wrap(<RemoteView />));
    await waitFor(() => {
      expect(screen.getByText('ready')).toBeDefined();
    });
    // Endpoint 同时出现在 iOS 卡片和 Tailscale 卡片中；
    // 断言至少存在一个匹配。
    const matches = screen.getAllByText('node.tail.net:4732');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('renders Tailscale fields', async () => {
    render(wrap(<RemoteView />));
    await waitFor(() => {
      // tailnet 名称 "tail.net" 是 Tailscale 卡片独有的。
      expect(screen.getByText('tail.net')).toBeDefined();
    });
    const ips = screen.getAllByText('100.64.0.1');
    expect(ips.length).toBeGreaterThanOrEqual(1);
  });

  it('renders the daemon preview text', async () => {
    render(wrap(<RemoteView />));
    await waitFor(() => {
      expect(screen.getByText(/tailscaled --tun/)).toBeDefined();
    });
  });

  it('Save forwards to reflect_update_remote_config with the new host', async () => {
    render(wrap(<RemoteView />));
    await waitFor(() => screen.getByTestId('remote-edit-btn'));
    fireEvent.click(screen.getByTestId('remote-edit-btn'));
    fireEvent.change(screen.getByTestId('remote-form-host'), {
      target: { value: 'updated.tail.net' },
    });
    fireEvent.click(screen.getByTestId('remote-form-submit'));
    await waitFor(() => {
      expect(
        calls.some(
          (c) =>
            c.cmd === 'reflect_update_remote_config' &&
            (c.args as { host: string }).host === 'updated.tail.net',
        ),
      ).toBe(true);
    });
  });

  // ── v1.11 基建#12:远程网页访问状态服务器 ──────────────────────────

  it('status server card shows the off badge; Start forwards the port', async () => {
    render(wrap(<RemoteView />));
    await waitFor(() => {
      expect(screen.getByTestId('remote-status-server-card')).toBeDefined();
    });
    // 未启动 → off 徽标;Start 可点,Stop 禁用。
    expect(screen.getByText('off')).toBeDefined();
    const startBtn = screen.getByTestId('remote-status-server-start') as HTMLButtonElement;
    const stopBtn = screen.getByTestId('remote-status-server-stop') as HTMLButtonElement;
    expect(stopBtn.disabled).toBe(true);
    expect(startBtn.disabled).toBe(false);
    fireEvent.click(startBtn);
    await waitFor(() => {
      expect(
        calls.some(
          (c) => c.cmd === 'reflect_status_server_start' && (c.args as { port: number }).port === 4732,
        ),
      ).toBe(true);
    });
  });

  it('status server badge shows the running port when state reports one', async () => {
    // state 返回端口 → running 徽标;Start 禁用,Stop 可点并转发。
    const { reflect_status_server_state } = await import('@/utils/commands');
    (reflect_status_server_state as ReturnType<typeof vi.fn>).mockResolvedValue(4732);
    render(wrap(<RemoteView />));
    await waitFor(() => {
      expect(screen.getByText(/running on :4732/)).toBeDefined();
    });
    const startBtn = screen.getByTestId('remote-status-server-start') as HTMLButtonElement;
    const stopBtn = screen.getByTestId('remote-status-server-stop') as HTMLButtonElement;
    expect(startBtn.disabled).toBe(true);
    expect(stopBtn.disabled).toBe(false);
    fireEvent.click(stopBtn);
    await waitFor(() => {
      expect(calls.some((c) => c.cmd === 'reflect_status_server_stop')).toBe(true);
    });
  });
});