/**
 * useEnsureSession —— `/goal` 等「必须有已绑定会话」的操作的前置守卫。
 *
 * 返回 `ensureSessionReady()`：
 * - 已有 activeId → 等 `loadedSessionId === activeId`（ChatView bind →
 *   replay → hydrate 完成）后返回该 id；已加载时立即返回。
 * - 无 activeId（首页）→ `reflect_create_session()` 预分配 id → 导航过去
 *   → 同样等 hydrate 完成。ChatView 挂载的 bind 序列是异步的,轮询
 *   store 的 `loadedSessionId` 是唯一可靠的就绪信号 —— 提交 op 前必须
 *   等 bind,否则 op 会落到 rebind 前的旧线程上（正是 /goal 静默失效
 *   的根因）。
 *
 * 超时兜底：bind 迟迟不完成（后端 wedged 等）时 reject,让调用方的
 * catch 走错误 toast —— 显式失败优于静默把 op 挂错线程。
 */
import { useCallback } from 'react';
import { reflect_create_session } from '@/utils/commands';
import { useAgentStore } from '@/stores/agentStore';
import { useActiveSession } from './useSessions';

const BIND_TIMEOUT_MS = 10_000;
const POLL_MS = 100;

async function waitLoadedSession(id: string): Promise<void> {
  const start = Date.now();
  while (useAgentStore.getState().loadedSessionId !== id) {
    if (Date.now() - start > BIND_TIMEOUT_MS) {
      throw new Error(`session ${id} did not finish loading (bind timeout)`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

export function useEnsureSession() {
  const { setActiveId } = useActiveSession();

  return useCallback(
    async (activeId: string | null): Promise<string> => {
      if (activeId) {
        await waitLoadedSession(activeId);
        return activeId;
      }
      const id = await reflect_create_session();
      setActiveId(id);
      await waitLoadedSession(id);
      return id;
    },
    [setActiveId],
  );
}
