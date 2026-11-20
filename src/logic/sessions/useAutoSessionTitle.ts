/**
 * B：会话首次 turn 完成后自动生成 AI 标题（fire-and-forget）。
 *
 * 触发条件：本 hook 挂载于 ChatView，事件总线上出现 `turn_complete`
 * 即代表当前绑定会话完成了一个 turn（后端是单活动 AgentThread）。
 * 防重：每个会话在本组件生命周期内只尝试一次 —— 后端另有幂等护栏
 * （已有自定义名/AI 标题直接返回，不调模型），失败也静默放弃，
 * 避免每个 turn 都打一次模型。
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { subscribeAgentEvent } from '@/services/agentEventBus';
import { zhuye_generate_session_title } from '@/utils/commands';
import { SESSIONS_QUERY_KEY } from './useSessions';

export function useAutoSessionTitle(sessionId: string | null | undefined): void {
  const qc = useQueryClient();
  const attemptedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    return subscribeAgentEvent((event) => {
      if (event.msg.type !== 'turn_complete') return;
      void qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
      if (!sessionId || attemptedRef.current.has(sessionId)) return;
      attemptedRef.current.add(sessionId);
      void zhuye_generate_session_title(sessionId)
        .then(() => qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY }))
        .catch(() => {
          /* 生成失败 → 回退派生标题，不打扰用户。 */
        });
    });
  }, [sessionId, qc]);
}
