/**
 * src/logic/shell/useSessionBadges.ts —— harness 侧栏 / 任务中心的会话徽标。
 *
 * 数据源约定（单一真相，本 hook 不复制事件语义）：
 * - 前台会话（activeId）：主 agentStore 的 pending 队列 + turns 流式状态；
 * - 后台会话：backgroundSessions 注册表的投影（running / pending）；
 * - 其余会话：空闲。
 *
 * 输出直接对齐设计稿侧栏的「状态点 + 旗标 + 未读」三元组。
 */
import { useEffect, useMemo, useRef } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useBackgroundSessions } from '@/stores/backgroundSessions';
import type { SessionBadge } from '@/contracts/harness/shell';

/** 未读产出（后台会话结束但还没被打开过）——壳层 store 承载。 */
export interface UnreadRegistry {
  unread: Record<string, boolean>;
  markRead: (sessionId: string) => void;
  markUnread: (sessionId: string) => void;
}

export interface SessionBadgesResult {
  badges: Record<string, SessionBadge>;
  /** 待处理会话数（有待办旗标的会话数，对齐设计稿 sb-count）。 */
  pendingCount: number;
  /** 运行中的会话数。 */
  runningCount: number;
}

/** 由 pending 集合推导旗标类型：plan / ask（question / ask_user 归为 ask）。 */
function pendingFlagOf(pending: {
  approvals: unknown[];
  questions: unknown[];
  askUser: unknown[];
  plan: unknown | null;
}): SessionBadge['pending'] {
  if (pending.plan) return 'plan';
  if (pending.questions.length > 0 || pending.askUser.length > 0) return 'ask';
  return null;
}

export function useSessionBadges(
  activeId: string | null,
  sessionIds: readonly string[],
  unread: UnreadRegistry,
): SessionBadgesResult {
  // 前台会话的待确认交互与回合状态。
  const pendingApprovals = useAgentStore((s) => s.pendingApprovals);
  const pendingQuestions = useAgentStore((s) => s.pendingQuestions);
  const pendingAskUser = useAgentStore((s) => s.pendingAskUser);
  const pendingPlan = useAgentStore((s) => s.pendingPlan);
  const turns = useAgentStore((s) => s.turns);
  // 后台会话投影（引用稳定：zustand 每次 ingest 换引用）。
  const background = useBackgroundSessions((s) => s.sessions);

  const foregroundRunning = turns.some((turn) => turn.status === 'streaming');
  // 前台回合计时起点:非运行→运行盖戳,运行→非运行清零(实测 bug #9 ——
  // 不得拿会话创建时间冒充回合时长)。切会话后重置为重开回合盖新戳,
  // 比显示几十小时的累计误差诚实。
  const fgSinceRef = useRef<number | null>(null);
  const fgWasRunning = useRef(false);
  useEffect(() => {
    if (foregroundRunning && !fgWasRunning.current) fgSinceRef.current = Date.now();
    if (!foregroundRunning) fgSinceRef.current = null;
    fgWasRunning.current = foregroundRunning;
  }, [foregroundRunning]);
  const foregroundPending = useMemo(
    () => ({
      approvals: pendingApprovals,
      questions: pendingQuestions,
      askUser: pendingAskUser,
      plan: pendingPlan,
    }),
    [pendingApprovals, pendingQuestions, pendingAskUser, pendingPlan],
  );

  // 后台会话从运行转为停止（且不是当前会话）→ 标记未读产出。
  useEffect(() => {
    for (const [id, snapshot] of Object.entries(background)) {
      if (id === activeId) continue;
      if (!snapshot.running && !snapshot.pendingCount) unread.markUnread(id);
    }
    // unread registry 的函数引用稳定，不需要进依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [background, activeId]);

  const badges = useMemo(() => {
    const map: Record<string, SessionBadge> = {};
    for (const id of sessionIds) {
      if (id === activeId) {
        const flag = pendingFlagOf(foregroundPending);
        map[id] = {
          dot: flag === 'plan' ? 'wait' : flag === 'ask' ? 'q' : foregroundRunning ? 'run' : 'idle',
          pending: flag,
          unread: false,
          since: foregroundRunning ? (fgSinceRef.current ?? null) : null,
        };
        continue;
      }
      const snapshot = background[id];
      if (snapshot) {
        const flag = pendingFlagOf(snapshot.pending);
        map[id] = {
          dot: flag === 'plan' ? 'wait' : flag === 'ask' ? 'q' : snapshot.running ? 'run' : 'idle',
          pending: flag,
          unread: unread.unread[id] ?? false,
          since: snapshot.running ? snapshot.runningSince : null,
        };
        continue;
      }
      map[id] = { dot: 'idle', pending: null, unread: unread.unread[id] ?? false };
    }
    return map;
  }, [sessionIds, activeId, foregroundPending, foregroundRunning, background, unread.unread]);

  const pendingCount = useMemo(
    () => Object.values(badges).filter((b) => b.pending !== null).length,
    [badges],
  );
  const runningCount = useMemo(
    () => Object.values(badges).filter((b) => b.dot === 'run').length,
    [badges],
  );

  return { badges, pendingCount, runningCount };
}
