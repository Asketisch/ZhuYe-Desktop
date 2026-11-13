/**
 * zcode-shell —— v2 重设计组件测试(redesign/zcode-shell)。
 *
 * 覆盖:ZDock(计划/排队 chips + popover 交互)、审批接管卡(决策走 store)、
 * view-ring 切换(对话 ↔ 轨迹)、轨迹账本推导(traj.ts)。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ZDock } from '@/features/shell/zcode/ZDock';
import { ApprovalTakeover } from '@/features/shell/zcode/Takeovers';
import { TrajView } from '@/features/shell/zcode/TrajView';
import { deriveTrajEntries } from '@/features/shell/zcode/traj';
import { useAgentStore } from '@/stores/agentStore';
import type { Turn, TodoItem } from '@/stores/agentStore';
import { I18nProvider } from '@/utils/i18n';

function mount(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

/* ===== ZDock ===== */

describe('ZDock', () => {
  it('无 todo / goal / 排队时不渲染任何 chip', () => {
    useAgentStore.setState({ todos: [], queuedMessages: [], goalActive: false });
    const { container } = mount(<ZDock goalActive={false} goalText="" turnRunning={false} />);
    expect(container.querySelector('[data-testid="zcode-dock-todo"]')).toBeNull();
    expect(container.querySelector('[data-testid="zcode-dock-queue"]')).toBeNull();
    expect(container.querySelector('[data-testid="zcode-dock-goal"]')).toBeNull();
  });

  it('todo chip 显示进度并在 popover 中列出三态清单', () => {
    const todos: TodoItem[] = [
      { content: '定位根因', status: 'completed', active_form: null },
      { content: 'NT 收口', status: 'in_progress', active_form: '收口中' },
      { content: '回归', status: 'pending', active_form: null },
    ];
    useAgentStore.setState({ todos, queuedMessages: [], goalActive: false });
    mount(<ZDock goalActive={false} goalText="" turnRunning={false} />);
    const chip = screen.getByTestId('zcode-dock-todo');
    expect(chip.textContent).toContain('1/3');
    fireEvent.click(chip);
    expect(screen.getAllByText('定位根因').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/收口中/).length).toBeGreaterThanOrEqual(1);
  });

  it('排队 chip 列出消息并可移除(store action 被调)', () => {
    useAgentStore.setState({
      todos: [],
      goalActive: false,
      queuedMessages: [
        { id: 'q1', items: [], text: '第一条', createdAt: 1 },
        { id: 'q2', items: [], text: '第二条', createdAt: 2 },
      ],
    });
    const removeSpy = vi.spyOn(useAgentStore.getState(), 'removeQueued');
    mount(<ZDock goalActive={false} goalText="" turnRunning={true} />);
    fireEvent.click(screen.getByTestId('zcode-dock-queue'));
    expect(screen.getByText('第一条')).toBeDefined();
    // 移除按钮 = 队列行内的最后一个图标按钮(aria-label 移除)。
    const removeBtns = screen.getAllByLabelText(/移除|Remove/);
    fireEvent.click(removeBtns[0]);
    expect(removeSpy).toHaveBeenCalledWith('q1');
    removeSpy.mockRestore();
  });
});

/* ===== 审批接管卡 ===== */

describe('ApprovalTakeover', () => {
  const approval = {
    id: 'apr-1',
    kind: 'tool' as const,
    toolName: 'bash',
    argsSummary: 'cargo test --workspace',
    turnId: 't1',
  };

  beforeEach(() => {
    useAgentStore.setState({ pendingApprovals: [approval], pendingQuestions: [], pendingAskUser: [] });
  });

  it('渲染命令摘要与三按钮;允许一次 → store.approve(approve)', async () => {
    const spy = vi.spyOn(useAgentStore.getState(), 'approve').mockResolvedValue(undefined);
    mount(<ApprovalTakeover approval={approval} />);
    expect(screen.getByTestId('zcode-approval').textContent).toContain('cargo test --workspace');
    fireEvent.click(screen.getByTestId('zcode-approval-allow'));
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith('tool', 'apr-1', 'approve'));
    spy.mockRestore();
  });

  it('本次会话允许 → approve_for_session', async () => {
    const spy = vi.spyOn(useAgentStore.getState(), 'approve').mockResolvedValue(undefined);
    mount(<ApprovalTakeover approval={approval} />);
    fireEvent.click(screen.getByTestId('zcode-approval-session'));
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith('tool', 'apr-1', 'approve_for_session'));
    spy.mockRestore();
  });

  it('拒绝 → deny 理由', async () => {
    const denySpy = vi.spyOn(useAgentStore.getState(), 'approve').mockResolvedValue(undefined);
    mount(<ApprovalTakeover approval={approval} />);
    fireEvent.click(screen.getByTestId('zcode-approval-deny'));
    await vi.waitFor(() =>
      expect(denySpy).toHaveBeenCalledWith('tool', 'apr-1', { deny: { reason: 'denied by user' } }),
    );
    denySpy.mockRestore();
  });
});

/* ===== view-ring + 轨迹 ===== */

const demoTurns: Turn[] = [
  {
    id: 'turn-1',
    status: 'done',
    items: [
      { kind: 'user_text', text: '修一下 Windows 改名' },
      { kind: 'thinking', text: '疑点在句柄根' },
      { kind: 'tool_call', toolName: 'bash', argsSummary: '{"command":"git status"}', callId: 'c1', status: 'done' },
      { kind: 'tool_output', callId: 'c1', text: '=== 分支 === main', isError: false },
      { kind: 'assistant_text', text: '根因已定位' },
    ],
  },
];

describe('TrajView(view-ring 轨迹)', () => {
  beforeEach(() => {
    useAgentStore.setState({ turns: demoTurns, compactions: { count: 0, removedMessages: 0, tokensSaved: 0, last: null, records: [] } });
  });

  it('渲染密排账本:用户/助手/工具角色与工具名', () => {
    mount(<TrajView />);
    const ledger = screen.getByTestId('zcode-traj-ledger');
    expect(ledger.textContent).toMatch(/用户|User/);
    expect(ledger.textContent).toMatch(/助手|Assistant/);
    expect(ledger.textContent).toMatch(/工具|Tool/);
    expect(ledger.textContent).toContain('bash');
    expect(ledger.textContent).toContain('根因已定位');
  });

  it('选中记录打开检查器:层级/状态/参数分节', () => {
    mount(<TrajView />);
    fireEvent.click(screen.getAllByTestId(/^zcode-traj-row-/)[2]);
    const insp = screen.getByTestId('zcode-traj-inspector');
    expect(insp.textContent).toContain('第 1 轮');
    expect(insp.textContent).toContain('git status');
  });

  it('折叠调用:工具行隐藏、用户/助手行保留', () => {
    mount(<TrajView />);
    fireEvent.click(screen.getByTestId('zcode-traj-fold-calls'));
    const ledger = screen.getByTestId('zcode-traj-ledger');
    const visible = [...ledger.querySelectorAll('[data-rec]')].filter((el) => el.offsetHeight > 0);
    expect(visible.length).toBe(0);
    expect(ledger.textContent).toContain('根因已定位');
  });
});

/* ===== traj.ts 推导 ===== */

describe('deriveTrajEntries', () => {
  it('turn.items 推导为带轮次/步进边界的扁平账本;tool_output 为子调用行', () => {
    const entries = deriveTrajEntries(demoTurns, { count: 0, removedMessages: 0, tokensSaved: 0, last: null, records: [] });
    expect(entries.length).toBe(5);
    expect(entries[0]).toMatchObject({ role: 'user', turn: 1, step: 1, boundary: true });
    expect(entries[3]).toMatchObject({ role: 'tool_call', sub: true });
    expect(entries.every((e) => e.turn === 1)).toBe(true);
  });
});
