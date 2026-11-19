/**
 * src/stores/backgroundSessions.ts —— 后台会话注册表(v1.x 后台持续运行)。
 *
 * 背景:换绑会话不再杀旧线程(见 `src-tauri/src/state/rebind.rs`),后台
 * 会话的 turn 继续在引擎里跑,其事件经独立通道 `reflect_session_event`
 * (载荷 `{ session_id, event }`)送达 —— **主 reducer 不消化这路事件**
 * (它的状态面是「当前前台会话」的投影),本 store 负责轻量投影:
 *
 * - `running`:该会话是否有 turn 在跑(会话列表徽标);
 * - `pending`:待确认交互(审批 / 提问 / ask_user / plan)—— gate 请求
 *   不落 rollout,切回时必须由 `mergePendingInto` 合并进主 store,
 *   否则后台会话会静默卡死在审批上。
 *
 * pending 形状零漂移:每会话持一份主 reducer 的 scratch state,
 * `ingest` 直接跑同一份 `reduceEvent`(pending 构造 / turn 收尾清理 /
 * plan 流转全复用),本文件不复制任何事件语义。
 *
 * 已知限制(注释与 docs 同步):后台会话不能远程停止/应答 —— 须切回
 * 该会话操作;徽标 + toast 引导用户切回。
 */
import { create } from 'zustand';
import { onReflectSessionEvent } from '@/utils/commands';
import { t } from '@/utils/i18n/lookup';
import { reduceEvent } from './agent/reducer';
import { useAgentStore } from './agentStore';
import type {
  AgentState,
  PendingApproval,
  PendingAskUser,
  PendingPlan,
  PendingQuestion,
} from './agent/types';
import type { ReflectEvent } from '@/types/protocol';

/** 一次后台会话的待确认交互集合(形状 = 主 store 同名字段的子集)。 */
export interface BackgroundPending {
  approvals: PendingApproval[];
  questions: PendingQuestion[];
  askUser: PendingAskUser[];
  plan: PendingPlan | null;
}

/** 单个后台会话的投影快照(供会话列表徽标 / toast 消费)。 */
export interface BackgroundSessionSnapshot {
  running: boolean;
  pendingCount: number;
  pending: BackgroundPending;
  updatedAt: number;
}

interface BackgroundSessionsState {
  sessions: Record<string, BackgroundSessionSnapshot>;
  /** 消化一条后台事件(带 session id)。 */
  ingest: (sessionId: string, event: ReflectEvent) => void;
  /**
   * 切走时播种:该会话有 turn 正在前台跑(turn_started 是前台事件,后台
   * 通道不会再发)—— 播种 running 态,让徽标立即亮起;后续后台事件继续
   * 更新(降级线程的 delta 流到后台通道后,`reduceEvent` 的 mapTurn 会
   * 为未知 turn 惰性建条目,running 由此续上)。
   */
  seedRunning: (sessionId: string) => void;
  /**
   * 切回该会话后调用(bind → replay 水合完成时):把 pending 交互合并进
   * 主 store(rollout 不含 gate 请求,必须合并)并清除本 store 条目 ——
   * 之后该会话回到前台,事件重新走主 reducer。
   */
  mergePendingInto: (sessionId: string) => void;
  /** 会话删除 / 离开时清理投影与 scratch。 */
  clearSession: (sessionId: string) => void;
  /** 幂等订阅 `reflect_session_event`(AppProviders 挂载时调用)。 */
  subscribe: () => () => void;
}

/** 每会话一份主 reducer scratch(私有,不进 zustand 状态)。 */
const scratches = new Map<string, AgentState>();

function pendingOf(state: AgentState): BackgroundPending {
  return {
    approvals: state.pendingApprovals,
    questions: state.pendingQuestions,
    askUser: state.pendingAskUser,
    plan: state.pendingPlan,
  };
}

function pendingCountOf(pending: BackgroundPending): number {
  return (
    pending.approvals.length +
    pending.questions.length +
    pending.askUser.length +
    (pending.plan ? 1 : 0)
  );
}

export const useBackgroundSessions = create<BackgroundSessionsState>((set, get) => ({
  sessions: {},

  ingest: (sessionId, event) => {
    let scratch = scratches.get(sessionId);
    if (!scratch) {
      // 主 store 初始状态即合法空 AgentState(zustand getInitialState),
      // pending 构造 / 清理所需的全部字段齐备。
      scratch = { ...useAgentStore.getInitialState() };
      scratches.set(sessionId, scratch);
    }
    const patch = reduceEvent(scratch, event);
    Object.assign(scratch, patch);
    const pending = pendingOf(scratch);
    const pendingCount = pendingCountOf(pending);
    const previous = get().sessions[sessionId];
    // 新增待确认交互 → toast 引导切回(运行中/完成的普通事件不打扰)。
    // store 层拿不到 i18n context,用静态 lookup(reducer toast 同先例)。
    if (pendingCount > (previous?.pendingCount ?? 0)) {
      useAgentStore.getState().pushToast({
        kind: 'info',
        message: t('chat.backgroundPendingToast'),
        ttlMs: 6000,
      });
    }
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: {
          running: scratch.turns.some((turn) => turn.status === 'streaming'),
          pendingCount,
          pending,
          updatedAt: Date.now(),
        },
      },
    }));
  },

  seedRunning: (sessionId) => {
    set((state) => {
      const existing = state.sessions[sessionId];
      if (existing?.running) return state;
      const scratch = { ...useAgentStore.getInitialState() };
      scratches.set(sessionId, scratch);
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            running: true,
            pendingCount: existing?.pendingCount ?? 0,
            pending: existing?.pending ?? pendingOf(scratch),
            updatedAt: Date.now(),
          },
        },
      };
    });
  },

  mergePendingInto: (sessionId) => {
    const snapshot = get().sessions[sessionId];
    if (!snapshot) return;
    // 水合已清过 pending(changedSession),这里整体替换为后台记录值。
    useAgentStore.setState({
      pendingApprovals: snapshot.pending.approvals,
      pendingQuestions: snapshot.pending.questions,
      pendingAskUser: snapshot.pending.askUser,
      ...(snapshot.pending.plan ? { pendingPlan: snapshot.pending.plan } : {}),
    });
    scratches.delete(sessionId);
    set((state) => {
      const next = { ...state.sessions };
      delete next[sessionId];
      return { sessions: next };
    });
  },

  clearSession: (sessionId) => {
    scratches.delete(sessionId);
    set((state) => {
      if (!(sessionId in state.sessions)) return state;
      const next = { ...state.sessions };
      delete next[sessionId];
      return { sessions: next };
    });
  },

  subscribe: () => {
    let active = true;
    let unlisten: (() => void) | null = null;
    void onReflectSessionEvent((payload) => {
      if (active) get().ingest(payload.session_id, payload.event);
    }).then((un) => {
      if (active) {
        unlisten = un;
      } else {
        // StrictMode 双 mount:cleanup 已跑,立即关闭这次多余的监听。
        un();
      }
    });
    return () => {
      active = false;
      unlisten?.();
      unlisten = null;
    };
  },
}));

/** 诊断 / 测试:重置模块级 scratch(不清 zustand 状态,由调用方负责)。 */
export function __resetBackgroundScratchesForTests(): void {
  scratches.clear();
}
