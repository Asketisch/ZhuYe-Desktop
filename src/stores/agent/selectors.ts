/**
 * agentStore 派生选择器 —— 供 Composer / 通知 / 队列等消费方复用，
 * 避免「turn 是否在跑」的判断散落各处。
 */
import type { AgentState, QueuedMessage } from './types';

/** 当前会话是否存在运行中的 turn（status === 'streaming'）。 */
export function selectIsTurnRunning(state: Pick<AgentState, 'turns'>): boolean {
  return state.turns.some((turn) => turn.status === 'streaming');
}

/**
 * 是否存在待用户处理的交互（审批 / 提问 / 自由输入 / plan 审批）。
 * 队列排空在此时暂停 —— 消息不应插在「agent 等用户决定」的中间。
 */
export function selectHasPendingInteraction(state: Pick<AgentState, 'pendingApprovals' | 'pendingQuestions' | 'pendingAskUser' | 'pendingPlan'>): boolean {
  return (
    state.pendingApprovals.length > 0 ||
    state.pendingQuestions.length > 0 ||
    state.pendingAskUser.length > 0 ||
    state.pendingPlan !== null
  );
}

/**
 * v1.x 后台持续运行:队列按会话隔离 —— 只取属于当前前台会话的排队项
 * (`sessionId` 在入队时盖章;undefined 视作当前会话,兼容既有测试/调用)。
 * 后台会话的队列在它回到前台前排空暂停。
 */
export function selectQueuedForActiveSession(
  state: Pick<AgentState, 'queuedMessages' | 'loadedSessionId'>,
): QueuedMessage[] {
  // 两侧都归一到 null(入队盖章用 `?? undefined`,store 初值为 null),
  // 未绑定会话的队列项(旧数据/测试)视作属于当前会话。
  const active = state.loadedSessionId ?? null;
  return state.queuedMessages.filter((message) => (message.sessionId ?? null) === active);
}
