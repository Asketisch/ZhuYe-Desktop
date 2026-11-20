/**
 * Vitest — AgentsDock 测试（右 dock 子代理记录面板）。
 *
 * 覆盖：空态（无快照,挂载即拉一次快照）/ 单条记录渲染（状态点、
 * 任务摘要、耗时）与展开体（上下文环、子代理消息、工具行、最近事件）/
 * 手动刷新触发 Op::QuerySubagents。
 *
 * 数据不走 invoke 应答,而是直接给 agentStore 播种
 * `subagents.lastStatus`（快照）与 `subagents.feed`(进度）—— 与生产
 * reducer 写入的形状一致。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { AgentsDock } from '@/features/agents/AgentsDock';
import { useAgentStore } from '@/stores/agentStore';
import type { SubagentProgressEntry } from '@/stores/agentStore';
import type { SubagentStatusSnapshot } from '@/types/protocol';
import { mockInvoke } from '@/test/setup.tsx';

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

// useAgentsDock(→ useActiveSession)依赖 router hooks,这里 mock 掉。
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({ pathname: '/chat/sess-1' }),
}));

/** 单个子代理快照（镜像 SubagentStatusSnapshot,30s 前完成,历时 30s）。 */
const SNAP_CHILD: SubagentStatusSnapshot = {
  child_id: 'child-1',
  role: 'explorer',
  state: 'completed',
  started_at: new Date(Date.now() - 60000).toISOString(),
  finished_at: new Date(Date.now() - 30000).toISOString(),
  iteration: 3,
  total_tokens: 8192,
  last_event: 'Done: found 3 matches',
};

/** 进度 feed：一条中间消息 + 一对已配对的工具调用。 */
const FEED: SubagentProgressEntry[] = [
  { id: 'f1', childId: 'child-1', role: 'explorer', kind: 'message', text: 'scan the repo', at: Date.now() - 60000 },
  { id: 'f2', childId: 'child-1', role: 'explorer', kind: 'tool_begin', text: 'read_file', at: Date.now() - 50000 },
  { id: 'f3', childId: 'child-1', role: 'explorer', kind: 'tool_end', text: 'read_file', at: Date.now() - 49000 },
];

function resetStore() {
  useAgentStore.setState({
    subagents: { feed: [], lastStatus: null },
    contextWindowSize: null,
    turns: [],
  });
}

describe('AgentsDock', () => {
  beforeEach(() => {
    resetStore();
    mockInvoke('zhuye_query_subagents', vi.fn(async () => 'sub-1'));
  });

  afterEach(() => {
    cleanup();
    resetStore();
  });

  it('renders the empty state when no subagent snapshot exists', async () => {
    const handler = vi.fn(async () => 'sub-1');
    mockInvoke('zhuye_query_subagents', handler);

    render(<AgentsDock />);

    // 挂载即向后端要一次快照（Op::QuerySubagents）。
    await waitFor(() => expect(handler).toHaveBeenCalled());
    expect(screen.getByTestId('agents-dock')).toBeDefined();
    expect(screen.getByText('No subagent records in this session yet.')).toBeDefined();
    // 顶栏子标题带会话短 id 与数量。
    expect(screen.getByTestId('agents-dock').textContent).toContain('sess-1');
  });

  it('renders one record and expands its details', async () => {
    useAgentStore.setState({
      subagents: { feed: FEED, lastStatus: [SNAP_CHILD] },
      contextWindowSize: 128000,
    });

    const { container } = render(<AgentsDock />);

    const record = screen.getByTestId('agents-dock-record-0');
    expect(record).toBeDefined();
    // 状态点:completed → data-st="done";名称与任务摘要来自快照。
    expect(record.getAttribute('data-st')).toBe('done');
    expect(record.textContent).toContain('explorer');
    expect(record.textContent).toContain('Done: found 3 matches');
    // 耗时:60s 前启动、30s 前结束 → 30s。
    expect(record.textContent).toContain('30s');

    // 展开记录 → 上下文环(8192/128000 ≈ 6%)+ 子代理消息 + 工具行 + 最近事件。
    fireEvent.click(record.querySelector('.sa-head') as HTMLElement);
    const body = record.querySelector('.sa-body') as HTMLElement;
    expect(body).toBeDefined();
    expect(body.textContent).toContain('8,192 tok total');
    const ringNum = body.querySelector('.ctx-ring-num');
    expect(ringNum?.textContent).toBe('6');
    expect(body.textContent).toContain('scan the repo');
    expect(body.textContent).toContain('read_file');
    expect(body.textContent).toContain('Done: found 3 matches');
    // 工具行有配对耗时(1s)。
    const dur = body.querySelector('.tool .dur');
    expect(dur?.textContent).toBe('1s');
    // 展开态有 .open 类(CSS 由 .sa.open 驱动)。
    expect(record.className).toContain('open');
    expect(container).toBeDefined();
  });

  it('refresh button triggers another subagent query', async () => {
    const handler = vi.fn(async () => 'sub-1');
    mockInvoke('zhuye_query_subagents', handler);

    render(<AgentsDock />);
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('agents-dock-refresh'));
    await waitFor(() => expect(handler.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
