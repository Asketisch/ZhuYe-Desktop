/**
 * src/stores/backgroundSessions.ts —— 后台会话注册表(v1.x 后台持续运行)。
 *
 * 背景:换绑会话不再杀旧线程(见 `src-tauri/src/state/rebind.rs`),后台
 * 会话的 turn 继续在引擎里跑,其事件经独立通道 `zhuye_session_event`
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
 * scratch 同时承载该会话的**实时 turns 投影**:引擎只在回合**结束**时
 * 才把 assistant 消息落进 rollout,回合未结束(阻塞在 plan 审批、被
 * 中断…)时解析 session 文件复现不出助手历史 —— 降级时把前台投影播种
 * 进 scratch(`demote`),切回时由 `mergePendingInto` 与回放历史**并集
 * 合并**注回(按 turn id,回放为基、后台投影补缺),历史 / 运行态 /
 * 待审批交互才不随会话切换丢失。
 *
 * 已知限制(注释与 docs 同步):后台会话不能远程停止/应答 —— 须切回
 * 该会话操作;徽标 + toast 引导用户切回。
 */
import { create } from 'zustand';
import { onZhuyeSessionEvent, onZhuyeEventGap, zhuye_replay_session } from '@/utils/commands';
import { t } from '@/utils/i18n/lookup';
import { reduceEvent } from './agent/reducer';
import { turnsFromRollout } from './replay';
import { useAgentStore } from './agentStore';
import type {
  AgentState,
  PendingApproval,
  PendingAskUser,
  PendingPlan,
  PendingQuestion,
  Turn,
} from './agent/types';
import type { ZhuyeEvent } from '@/types/protocol';

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
  /** 当前运行回合起点 epoch ms;非运行态为 null(实测 bug #9 的诚实口径)。 */
  runningSince: number | null;
  pendingCount: number;
  pending: BackgroundPending;
  updatedAt: number;
}

/**
 * 前台会话降级进后台时播种的实时投影。
 *
 * 为什么要播种整份投影(而不是只记「在跑」):
 * - **在飞历史**:引擎只在**回合结束**时才把 assistant 消息落进 rollout,
 *   回合未结束(例如阻塞在 plan 审批)时解析 session 文件复现不出助手
 *   历史 —— 唯一能救回这段内容的是内存里的实时投影。
 * - **待确认交互**:审批 / 提问 / ask_user / plan 是 gate 请求,**压根不
 *   落 rollout**,只能靠内存投影跨会话切换存活(否则切回后审批框消失、
 *   回合永远挂起)。
 */
export interface ForegroundProjection {
  turns: Turn[];
  pendingApprovals: PendingApproval[];
  pendingQuestions: PendingQuestion[];
  pendingAskUser: PendingAskUser[];
  pendingPlan: PendingPlan | null;
}

interface BackgroundSessionsState {
  sessions: Record<string, BackgroundSessionSnapshot>;
  /** 消化一条后台事件(带 session id)。 */
  ingest: (sessionId: string, event: ZhuyeEvent) => void;
  /**
   * 前台 → 后台降级:用前台当前投影播种该会话的 scratch(turns + 待确认
   * 交互)。之后该会话在后台收到的事件继续叠加在同一份 scratch 上 ——
   * 它就是该会话的完整实时投影。
   */
  demote: (sessionId: string, projection: ForegroundProjection) => void;
  /**
   * 切回该会话后调用(bind → replay 水合完成时):把后台投影与回放历史
   * **并集合并**进主 store(按 turn id:回放为基,后台实时投影补在飞
   * delta / 未落盘新轮)—— 待确认交互(rollout 不含 gate 请求)整体
   * 替换为后台记录值,否则会话会静默卡在审批上 / 历史凭空消失。
   * 之后该会话回到前台,事件重新走主 reducer。
   */
  mergePendingInto: (sessionId: string) => void;
  /** 会话删除 / 离开时清理投影与 scratch。 */
  clearSession: (sessionId: string) => void;
  /** 幂等订阅 `zhuye_session_event`(AppProviders 挂载时调用)。 */
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
    const now = Date.now();
    const running = scratch.turns.some((turn) => turn.status === 'streaming');
    // 运行起点盖戳:非运行→运行 = now;持续运行保持原戳;运行→非运行清零
    // (侧栏回合计时口径,实测 bug #9 —— 不得拿会话创建时间冒充)。
    const runningSince = running
      ? (previous?.runningSince ?? now)
      : null;
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: {
          running,
          runningSince,
          pendingCount,
          pending,
          updatedAt: now,
        },
      },
    }));
  },

  demote: (sessionId, projection) => {
    let scratch = scratches.get(sessionId);
    if (!scratch) {
      // 主 store 初始状态即合法空 AgentState(zustand getInitialState),
      // pending 构造 / 清理所需的全部字段齐备。
      scratch = { ...useAgentStore.getInitialState() };
      scratches.set(sessionId, scratch);
    }
    // 前台是当前投影的权威源:会话在前台期间它的事件全走前台通道,
    // 主 store 持有完整实时投影。播种后,后台事件继续叠加在同一份
    // scratch 上 —— 它就是该会话跨会话切换存活的完整投影。
    scratch.turns = projection.turns.map((turn) => ({ ...turn, items: [...turn.items] }));
    scratch.pendingApprovals = projection.pendingApprovals;
    scratch.pendingQuestions = projection.pendingQuestions;
    scratch.pendingAskUser = projection.pendingAskUser;
    scratch.pendingPlan = projection.pendingPlan;
    scratch.loadedSessionId = sessionId;
    const pending = pendingOf(scratch);
    const pendingCount = pendingCountOf(pending);
    const running = scratch.turns.some((turn) => turn.status === 'streaming');
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: {
          running,
          runningSince: running ? Date.now() : null,
          pendingCount,
          pending,
          updatedAt: Date.now(),
        },
      },
    }));
  },

  mergePendingInto: (sessionId) => {
    const snapshot = get().sessions[sessionId];
    if (!snapshot) return;
    const scratch = scratches.get(sessionId);
    // 水合已清过 pending(changedSession),这里整体替换为后台记录值。
    // turns 做**并集合并**(旧实现「scratch 非空即整表覆盖」):当前主
    // store 的 turns = 回放历史 + promote 后窗口期的前台事件,是合并基;
    // scratch 是后台实时投影(在飞 delta / 未落盘的新轮)。按 turn id:
    // - 基里已有 → 取 items 更多的一份(scratch 持续叠加则更鲜;回放
    //   更全则保回放),同长度取 scratch(后台投影);
    // - scratch 独有 → 追加(后台期间新开、尚未落盘的轮)。
    // 旧整表覆盖在「空闲切走 → 引擎自续产生后台事件 → scratch 从空
    // 初始化」时会用只含新轮的投影抹掉整段回放历史(切回后历史凭空
    // 消失的最严重形态)。
    const base = useAgentStore.getState().turns;
    let turns = base;
    if (scratch && scratch.turns.length > 0) {
      const byId = new Map(base.map((turn) => [turn.id, turn]));
      for (const st of scratch.turns) {
        const existing = byId.get(st.id);
        byId.set(st.id, !existing || st.items.length >= existing.items.length ? st : existing);
      }
      turns = [...byId.values()];
    }
    useAgentStore.setState({
      pendingApprovals: snapshot.pending.approvals,
      pendingQuestions: snapshot.pending.questions,
      pendingAskUser: snapshot.pending.askUser,
      ...(snapshot.pending.plan ? { pendingPlan: snapshot.pending.plan } : {}),
      ...(scratch && scratch.turns.length > 0 ? { turns } : {}),
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
    let unlistenGap: (() => void) | null = null;
    void onZhuyeSessionEvent((payload) => {
      if (active) get().ingest(payload.session_id, payload.event);
    }).then((un) => {
      if (active) {
        unlisten = un;
      } else {
        // StrictMode 双 mount:cleanup 已跑,立即关闭这次多余的监听。
        un();
      }
    });
    // v1.12:后台缺口 → scratch 的 turns 投影发散,按 replay 重灌各后台
    // 会话(pending 不动:后台广播丢的 gate 在切回时由 bind 的
    // pending_gates 水合兜底 —— 引擎侧注册表是权威)。gap 载荷不辨
    // session(broadcast 级丢弃),对注册表内全部后台会话重灌;数量小
    // 且重灌仅在后台有投影时发生,代价可忽略。
    void onZhuyeEventGap((gap) => {
      if (!active || gap.scope !== 'background') return;
      const scratchIds = [...scratches.keys()];
      for (const sid of scratchIds) {
        void zhuye_replay_session(sid)
          .then((records) => {
            const scratch = scratches.get(sid);
            if (!scratch) return;
            const { turns } = turnsFromRollout(records);
            // 只重灌 scratch(mergePendingInto 的数据源);快照上的
            // pendingCount 不动 —— pending 以引擎注册表为权威,切回时兜底。
            scratch.turns = turns;
          })
          .catch(() => {});
      }
    }).then((un) => {
      if (active) unlistenGap = un;
      else un();
    });
    return () => {
      active = false;
      unlisten?.();
      unlisten = null;
      unlistenGap?.();
      unlistenGap = null;
    };
  },
}));

/** 诊断 / 测试:重置模块级 scratch(不清 zustand 状态,由调用方负责)。 */
export function __resetBackgroundScratchesForTests(): void {
  scratches.clear();
}
