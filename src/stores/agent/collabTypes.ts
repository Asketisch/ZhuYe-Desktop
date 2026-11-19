/**
 * 协作域状态类型(Collab* 事件投影)—— 从 `types.ts` 拆出的专题类型
 * (types.ts 逼近 500 行预算,先例同 `./tokenTypes` / `./attachmentTypes`)。
 */

/** 一次讨论会话的投影(collab_started / collab_finished 等)。 */
export interface CollabSession {
  id: string;
  participants: string[];
  mode: string;
  startedAt: number;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  outcome?: string;
  rounds?: number;
  messages: CollabMessage[];
}

/** 讨论中的单条发言。 */
export interface CollabMessage {
  from: string;
  kind: string;
  content: string;
  round: number;
  at: number;
}

/** 模型路由切换快照(routing 事件)。 */
export interface RoutingSnapshot {
  kind: 'switched' | 'failed_over' | 'cooldown_started' | 'cooldown_cleared' | 'spec_fallback';
  role: string;
  from?: string;
  to?: string;
  reason: string;
}
