/**
 * Vitest — SessionItem 运行态徽标。
 *
 * 契约:
 * - **运行点**:活动会话的运行态取自主 store(该会话正挂在主投影上),
 *   非活动会话取自后台注册表 —— 两者徽标形态统一(同一个呼吸点)。
 * - **待确认数**:活动会话的 pending(审批 / 提问 / ask_user / plan)取自主
 *   store,非活动会话取自后台注册表。gate 请求不落 rollout,徽标是用户
 *   唯一的「这边还有事等你」线索。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionItem } from './SessionItem';
import { useAgentStore } from '@/stores/agentStore';
import { __resetBackgroundScratchesForTests, useBackgroundSessions } from '@/stores/backgroundSessions';
import type { ZhuyeSessionInfo } from '@/utils/commands';

function sess(id: string): ZhuyeSessionInfo {
  return {
    session_id: id,
    model: 'stub/test',
    started_at: new Date().toISOString(),
    message_count: 2,
    workspace: '/ws',
  };
}

beforeEach(() => {
  __resetBackgroundScratchesForTests();
  useBackgroundSessions.setState({ sessions: {} });
  useAgentStore.getState().reset();
});

describe('SessionItem 运行态徽标', () => {
  it('活动会话有在飞 turn → 显示运行点', () => {
    useAgentStore.setState({
      loadedSessionId: 's1',
      turns: [{ id: 't1', items: [], status: 'streaming' }],
    });
    render(<SessionItem session={sess('s1')} active onClick={() => {}} />);
    expect(screen.getByTestId('session-running-s1')).toBeDefined();
  });

  it('活动会话无在飞 turn → 不显示运行点', () => {
    useAgentStore.setState({
      loadedSessionId: 's1',
      turns: [{ id: 't1', items: [], status: 'done' }],
    });
    render(<SessionItem session={sess('s1')} active onClick={() => {}} />);
    expect(screen.queryByTestId('session-running-s1')).toBeNull();
  });

  it('非活动会话在后台运行 → 显示运行点', () => {
    useBackgroundSessions.setState({
      sessions: {
        s2: { running: true, pendingCount: 0, pending: { approvals: [], questions: [], askUser: [], plan: null }, updatedAt: 0 },
      },
    });
    render(<SessionItem session={sess('s2')} active={false} onClick={() => {}} />);
    expect(screen.getByTestId('session-running-s2')).toBeDefined();
  });

  it('活动会话有待审批 plan → 显示待确认徽标', () => {
    useAgentStore.setState({
      loadedSessionId: 's1',
      pendingPlan: {
        id: 'p1',
        kind: 'ready',
        payload: { type: 'plan_ready', plan_id: 'p1', markdown: '# plan' },
        turnId: 't1',
      },
    });
    render(<SessionItem session={sess('s1')} active onClick={() => {}} />);
    expect(screen.getByTestId('session-pending-s1').textContent).toBe('●1');
  });

  it('非活动会话在后台有待确认交互 → 显示待确认徽标', () => {
    useBackgroundSessions.setState({
      sessions: {
        s2: {
          running: false,
          pendingCount: 2,
          pending: { approvals: [], questions: [], askUser: [], plan: null },
          updatedAt: 0,
        },
      },
    });
    render(<SessionItem session={sess('s2')} active={false} onClick={() => {}} />);
    expect(screen.getByTestId('session-pending-s2').textContent).toBe('●2');
  });
});
