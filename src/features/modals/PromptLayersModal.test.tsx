/**
 * Vitest — PromptLayersModal 测试(v1.6.1 提示词层)。
 *
 * 面板消费 store 的 `prompt` 投影(由 reducer 从 `prompt_list` /
 * `prompt_switched` 事件写入),不自行发起查询。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { PromptLayersModal } from './PromptLayersModal';
import { useAgentStore } from '@/stores/agentStore';
import { createTestQueryClient, mockInvoke, resetMockInvoke } from '@/test/setup.tsx';

function wrap(node: React.ReactNode) {
  return <QueryClientProvider client={createTestQueryClient()}>{node}</QueryClientProvider>;
}

const PROMPT = {
  available: ['claude', 'gpt', 'my-layer'],
  currentSpec: 'anthropic/claude-sonnet-4',
  activeLayers: ['my-layer'],
  switchedAt: null,
};

describe('PromptLayersModal', () => {
  beforeEach(() => {
    resetMockInvoke();
    useAgentStore.setState({ promptPanelOpen: false, prompt: null });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders nothing while the panel is closed', () => {
    render(wrap(<PromptLayersModal />));
    expect(screen.queryByTestId('prompt-layers-available')).toBeNull();
  });

  it('renders the current spec, active layers and available layers', () => {
    useAgentStore.setState({ promptPanelOpen: true, prompt: PROMPT });
    render(wrap(<PromptLayersModal />));

    expect(screen.getByText('anthropic/claude-sonnet-4')).toBeDefined();
    const active = screen.getByTestId('prompt-layers-active');
    expect(active.textContent).toContain('my-layer');
    const available = screen.getByTestId('prompt-layers-available');
    expect(available.textContent).toContain('claude');
    expect(available.textContent).toContain('gpt');
    expect(available.textContent).toContain('my-layer');
  });

  it('shows the empty state when the library reports no layers', () => {
    useAgentStore.setState({
      promptPanelOpen: true,
      prompt: { ...PROMPT, available: [], activeLayers: [] },
    });
    render(wrap(<PromptLayersModal />));
    expect(screen.getAllByText('None').length).toBeGreaterThan(0);
  });

  it('rescan triggers the switch action and re-queries the list', async () => {
    const calls: unknown[] = [];
    // mock 的 handler 签名是 (cmd, args) —— args 即 invoke 的第二参数。
    mockInvoke('reflect_prompt_command', async (_cmd, args) => {
      calls.push(args);
      return 'sub-1';
    });
    useAgentStore.setState({ promptPanelOpen: true, prompt: PROMPT });
    render(wrap(<PromptLayersModal />));

    fireEvent.click(screen.getByTestId('prompt-layers-rescan'));

    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));
    const actions = calls.map((c) => (c as { action: { type: string } }).action.type);
    expect(actions).toContain('switch');
    expect(actions).toContain('list');
    // switch 动作的 layer 槽位当前固定为 null(全量重扫)。
    const switchCall = calls.find(
      (c) => (c as { action: { type: string } }).action.type === 'switch',
    ) as { action: { type: string; layer: string | null } };
    expect(switchCall.action.layer).toBeNull();
  });

  it('expands the effective prompt body on demand', async () => {
    mockInvoke('reflect_get_effective_prompt', async () => ({
      model: 'anthropic/claude-sonnet-4-latest',
      layers: ['my-layer'],
      sections: [{ key: 'system.main', content: '你是一名编码助手。' }],
    }));
    useAgentStore.setState({ promptPanelOpen: true, prompt: PROMPT });
    render(wrap(<PromptLayersModal />));

    // 默认折叠 —— 生效正文按需拉取(不自动查)。
    expect(screen.queryByTestId('prompt-layers-body')).toBeNull();

    fireEvent.click(screen.getByTestId('prompt-layers-toggle-body'));

    // 容器先出现(加载态),正文随后到达 —— 等内容而不是等容器。
    await waitFor(() => {
      expect(screen.getByTestId('prompt-layers-body').textContent).toContain('system.main');
    });
    expect(screen.getByTestId('prompt-layers-body').textContent).toContain('你是一名编码助手。');
  });
});
