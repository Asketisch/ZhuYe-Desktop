/**
 * 跟进消息队列(C:Queue vs Steer)的 store actions 工厂。
 * v1.x 后台持续运行:队列按会话隔离 —— 每条排队项入队时盖章
 * `sessionId`(取当时的 `loadedSessionId`),展示与排空只作用于前台会话
 * (`selectQueuedForActiveSession`;undefined 视作当前会话,兼容旧数据)。
 */
import type { StoreApi } from 'zustand';
import type { AgentState } from './types';
import type { UserInputItem } from '@/types/protocol';
import { selectHasPendingInteraction, selectIsTurnRunning, selectQueuedForActiveSession } from './selectors';
import { uuid } from './toast';

type SetAgentState = StoreApi<AgentState>['setState'];
type GetAgentState = StoreApi<AgentState>['getState'];

export function createQueueActions(set: SetAgentState, get: GetAgentState) {
  return {
    enqueueMessage: (items: UserInputItem[], workspace?: string | null) => {
      const firstText = items.find(
        (item): item is { type: 'text'; text: string } => item.type === 'text',
      );
      set((state) => ({
        queuedMessages: [
          ...state.queuedMessages,
          {
            id: uuid(),
            items,
            text: firstText?.text ?? `(${items.length} attachments)`,
            ...(workspace ? { workspace } : {}),
            // 入队盖章会话,队列按会话隔离。
            sessionId: state.loadedSessionId ?? undefined,
            createdAt: Date.now(),
          },
        ],
      }));
    },

    removeQueued: (id: string) => {
      set((state) => ({ queuedMessages: state.queuedMessages.filter((m) => m.id !== id) }));
    },

    updateQueued: (id: string, text: string) => {
      set((state) => ({
        queuedMessages: state.queuedMessages.map((m) => {
          if (m.id !== id) return m;
          // 仅更新首个 text item；附件项原样保留。
          let replaced = false;
          const items = m.items.map((item) => {
            if (!replaced && item.type === 'text') {
              replaced = true;
              return { ...item, text };
            }
            return item;
          });
          if (!replaced) items.unshift({ type: 'text', text });
          return { ...m, items, text };
        }),
      }));
    },

    drainQueue: async () => {
      const state = get();
      // 只排空前台会话的队列(undefined 视作当前会话)。
      const activeQueue = selectQueuedForActiveSession(state);
      if (activeQueue.length === 0) return;
      if (selectIsTurnRunning(state)) return;
      // 审批/提问/输入/plan 等待中 → 暂停排空，处理完后由下一次事件再触发。
      if (selectHasPendingInteraction(state)) return;
      const [next] = activeQueue;
      // 从完整队列摘掉该条(保序;其余会话的队列项不受影响)。
      const rest = state.queuedMessages.filter((message) => message.id !== next.id);
      set({ queuedMessages: rest });
      try {
        await state.submitItems(next.items, next.workspace ?? undefined);
      } catch (error) {
        // 提交失败:消息放回队首等下一次事件重试,不静默丢弃。
        // 若用户期间编辑过队列(该条已不在),仍放回最前,保证不丢内容。
        const current = get();
        const queued = current.queuedMessages.some((m) => m.id === next.id)
          ? current.queuedMessages
          : [next, ...current.queuedMessages];
        current.pushToast({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
        set({ queuedMessages: queued });
      }
    },
  };
}
