import { create } from 'zustand';
import { subscribeAgentEvent } from '@/services/agentEventBus';
import type { PermissionMode, ZhuyeEvent, ZhuyeSubmission } from '@/types/protocol';
import { normalizePermissionMode } from '@/types/protocol';
import {
  zhuye_ask_user_input_response,
  zhuye_ask_user_question_response,
  zhuye_compact,
  zhuye_get_config,
  zhuye_hook_approval,
  zhuye_interrupt,
  zhuye_mcp_elicitation_response,
  zhuye_prompt_command,
  zhuye_query_guard_stats,
  zhuye_replay_session,
  onZhuyeEventGap,
  zhuye_query_subagents,
  zhuye_rewind,
  zhuye_set_effort,
  zhuye_shutdown,
  zhuye_steer,
  zhuye_goal_snapshot,
  zhuye_submit,
  zhuye_tool_approval,
} from '@/utils/commands';
import { planFromRollout, turnsFromRollout } from '../replay';
import {
  createAutoCompactController,
} from './policy/autoCompact';
import {
  createWiredPlanFailoverController,
  extractExhaustionSignal,
} from './policy/planFailover';
import { reduceEvent } from './reducer';
import { appendItem, markTurn, userAttachmentsFromItems } from './turns';
import { runQueryGuardStats } from './policy/guardStats'; // F01
import { wireApprovalPolicy } from './policy/approvalPolicy';
import { clearStalePromptSelection } from './policy/promptSelection';
import { createQueueActions } from './queue';
import { createPlanActions } from './policy/planActions';
import { createToastActions, uuid } from './toast';
import type { AgentState, SubagentsState, TurnItem } from './types';
import type { PendingGateSnapshot } from '@/types/protocol';
import { gatesToSyntheticEvents, filterStalePlanRequestGates } from './pendingGates';
import { createSessionSeqTracker } from './eventGap';
export const useAgentStore = create<AgentState>((set, get) => {
  // 会话作用域的子代理可观测投影的空态(复用引用,避免每处字面量)。
  const EMPTY_SUBAGENTS: SubagentsState = { feed: [], lastStatus: null };
  let goalSnapshotGeneration = 0;
  // v1.12:seq 缺口跟踪器(实现见 ./eventGap)—— Event.seq 缺口与
  // zhuye_event_gap(转发器 Lagged)两条触发路径共用同一收敛:当前会话
  // re-replay(重放覆盖落盘部分;半截流式文本本就不入盘)。
  const seqTracker = createSessionSeqTracker(() => {
    const sid = get().loadedSessionId;
    if (!sid) return;
    void zhuye_replay_session(sid)
      .then((records) => {
        if (get().loadedSessionId === sid && records) {
          get().hydrateSession?.(sid, records);
        }
      })
      .catch(() => {});
  });
  // 按 plan 最大上下文自动压缩控制器(内部有开关/节流/触发闩)。
  const autoCompact = createAutoCompactController({
    getConfig: () => zhuye_get_config(),
    compact: () => zhuye_compact(),
  });
  // coding plan 耗尽自动切换控制器:闭包持有 get/set,防抖状态随 store 生命周期
  // (接线细节收进 planFailover 模块,store 构造期一行接入)。
  const planFailover = createWiredPlanFailoverController(get, set);
  return {
  turns: [],
  session: null,
  permissionMode: 'auto',
  pendingApprovals: [],
  pendingQuestions: [],
  pendingAskUser: [],
  pendingElicitations: [],
  pendingPlan: null,
  plan: null,
  planDraft: null,
  mcpServers: [],
  lspServers: [],
  lastError: null,
  subscribed: false,
  loadedSessionId: null,
  worktreeIntent: null,
  hydrateSession: (id, records) => {
    goalSnapshotGeneration += 1;
    const { turns, compactions } = turnsFromRollout(records);
    // plan 终稿从最后一条 plan_ready record 恢复;草稿不持久化,重载即清空。
    const plan = planFromRollout(records);
    const changedSession = get().loadedSessionId !== id;
    // v1.12:换会话 → 扇出序号水位复位(引擎 per-session 计数)。
    if (changedSession) seqTracker.reset();
    // goalActive/goalSnapshot 一并复位:goal 挂在后端线程上,rebind 造新
    // 线程即丢,换会话后旧投影不可信（同 id 重放也复位 —— goal 本就不入盘）。
    // 复位后立即向后端快照校准（zhuye_goal_snapshot,v1.7 读口）;subagents
    // 同为会话作用域投影。token 投影同理:live 的按模型累计属于上一个会话,
    // 换会话后必须清空(落盘侧累计由 `/usage` 按 session id 现查,不受影响)。
    set({
      turns,
      compactions,
      loadedSessionId: id,
      ...(changedSession ? {
        pendingApprovals: [], pendingQuestions: [], pendingAskUser: [], pendingPlan: null,
        pendingElicitations: [],
        lastRouting: null,
        // worktree 意图挂「新建草稿」上,换会话即作废(防误建树)。
        worktreeIntent: null,
      } : {}),
      lastError: null,
      queuedMessages: [],
      goalActive: false,
      goalSnapshot: null,
      subagents: EMPTY_SUBAGENTS,
      todos: [],
      planSteps: [],
      plan,
      planDraft: null,
      tokens: null,
      contextWindowSize: null,
      contextComposition: null,
    });
    void get().syncGoalSnapshot();
  },

  // v1.12:引擎侧挂起交互快照水合(reload / 换绑后审批 UI 不再依赖前端
  // 内存投影)。快照行 → 合成事件走同一份 reduceEvent(零语义复制,
  // 见 ./pendingGates);按 request_id 去重 —— mergePendingInto 的后台
  // scratch 投影更鲜,已在场的挂起态不重复添加。
  hydratePendingGates: (gates: PendingGateSnapshot[]) => {
    const knownIds = [
      ...get().pendingApprovals.map((a) => a.id),
      ...get().pendingQuestions.map((q) => q.id),
      ...get().pendingAskUser.map((u) => u.id),
      ...(get().pendingPlan ? [get().pendingPlan!.id] : []),
    ];
    // Plan 模式的 plan_request 僵尸过滤见 ./pendingGates.ts(口径注释在那边)。
    const effective = filterStalePlanRequestGates(gates, get().permissionMode);
    for (const msg of gatesToSyntheticEvents(effective, knownIds)) {
      const patch = reduceEvent(get(), { id: '', msg, seq: 0 });
      if (Object.keys(patch).length > 0) set(patch);
    }
  },
  clearSession: () => {
    goalSnapshotGeneration += 1;
    set({
      turns: [],
      loadedSessionId: null,
      pendingApprovals: [],
      pendingQuestions: [],
      pendingAskUser: [],
      pendingElicitations: [],
      pendingPlan: null,
      plan: null,
      planDraft: null,
      queuedMessages: [],
      worktreeIntent: null, // 回到首页 = 新草稿,隔离意图一并清空
      // 会话域的遥测/路由数据一并重置:回到首页(或新会话首事件到来前)
      // 不应展示上一个会话的 token/压缩/路由;planFailover 的
      // currentProvider 兜底也不应读到旧会话的 provider。
      session: null,
      tokens: null,
      contextWindowSize: null,
      contextComposition: null,
      compactions: { count: 0, removedMessages: 0, tokensSaved: 0, last: null, records: [] },
      lastRouting: null,
      subagents: EMPTY_SUBAGENTS,
      todos: [],
      planSteps: [],
      goalActive: false,
      goalSnapshot: null,
    });
  },
  tokens: null,
  contextWindowSize: null,
  contextComposition: null,
  queuedMessages: [],
  collabSessions: [],
  mcpInvocations: [],
  lastRouting: null,
  configReloadedAt: null,
  planFailover: null,
  compactions: { count: 0, removedMessages: 0, tokensSaved: 0, last: null, records: [] },
  toasts: [],
  goalActive: false,
  goalSnapshot: null,
  subagents: EMPTY_SUBAGENTS,
  todos: [],
  planSteps: [],
  loadedPlugins: [],
  // 提示词层状态(v1.6.1)/ F01 guard 统计 —— 进程级,不随会话切换重置。
  prompt: null,
  guardStats: null,
  promptPanelOpen: false,
  openPromptPanel: () => set({ promptPanelOpen: true }),
  closePromptPanel: () => set({ promptPanelOpen: false }),
  // goalActive 落 false 的所有路径(手动退出/会话清理)一并清快照 ——
  // 两者必须同真同假,徽标 tooltip 不会挂着旧目标的进度。
  setGoalActive: (active) => {
    goalSnapshotGeneration += 1;
    set(active ? { goalActive: true } : { goalActive: false, goalSnapshot: null });
  },
  syncGoalSnapshot: async () => {
    const generation = ++goalSnapshotGeneration;
    try {
      const snapshot = await zhuye_goal_snapshot();
      if (generation !== goalSnapshotGeneration) return;
      // 快照是权威:有 = 活跃(拉回 true),无 = 未挂载/rebind 丢失(落 false)。
      set({ goalSnapshot: snapshot, goalActive: snapshot !== null });
    } catch {
      // 读失败(线程未就绪等)不动现有投影,避免把乐观状态闪掉。
    }
  },

  subscribe: () => {
    if (get().subscribed) return () => {};
    set({ subscribed: true });
    const unsubscribe = subscribeAgentEvent((event: ZhuyeEvent) => {
      // v1.12:seq 缺口检测 + 重放收敛(实现见 ./eventGap)。
      seqTracker.observe(event);
      const patch = reduceEvent(get(), event);
      if (Object.keys(patch).length > 0) set(patch);
      // C：turn 收尾后自动排空跟进队列（reduce 完成后再取最新状态判断）。
      if (event.msg.type === 'turn_complete' || event.msg.type === 'turn_aborted') {
        if (event.msg.type === 'turn_complete') void get().drainQueue();
        // v1.4 C1:本会话出现过子代理活动 → turn 收尾自动拉一次状态
        // 快照,让 Inspector 的子代理区块反映终态(running → completed/
        // failed/cancelled),无需手动刷新。
        if (get().subagents.feed.length > 0) {
          void get().querySubagents().catch(() => {});
        }
        // v1.7:目标模式的 goal turn 收尾会推进快照(turn_count/status,
        // 完成时控制器被 clear)—— 拉一次快照校准 goalActive/徽标。
        if (get().goalActive) {
          void get().syncGoalSnapshot();
        }
      }
      // coding plan 额度耗尽 → 自动切换默认供应商（内部有开关 + 防抖）。
      if (event.msg.type === 'quota_exhausted' || event.msg.type === 'error') {
        const signal = extractExhaustionSignal(event.msg, get().session?.provider ?? null);
        if (signal) void planFailover.handle(signal);
      }
      // 提示词方案失效自清理:bind 恢复重发的手动 profile 已不在当前线程
      // 提示词库(换工作区/内置变体改名/用户层被删)时引擎报本错误且校验
      // 失败不落 rollout —— 清掉 per-session 缓存键(不清则每次切回该会话
      // 重复报错),层清单重拉让权威 selection 经 prompt_list 事件回流。
      if (event.msg.type === 'error' && event.msg.code === 'PROMPT_PROFILE_NOT_FOUND') {
        clearStalePromptSelection(get().loadedSessionId);
        void get().promptList().catch(() => {});
      }
      // plan 最大上下文 ≥80% → 自动压缩（内部有开关/节流/触发闩）。
      if (event.msg.type === 'token_count') {
        const state = get();
        const eventModel = event.msg.model;
        const sessionModel = state.session?.model;
        const sameModel = !eventModel || !sessionModel || eventModel === sessionModel || sessionModel.endsWith(`/${eventModel}`) || eventModel.endsWith(`/${sessionModel}`);
        void autoCompact(event.msg.input_tokens ?? 0, eventModel, sameModel ? state.contextWindowSize : null);
      }
    });
    // v1.12:转发器 Lagged 缺口通知 —— seq 检测覆盖不到的丢事件
    // (per-turn 快路的 broadcast 丢包)由此兜底;后台缺口由
    // backgroundSessions 自己的 gap 监听定向重灌。
    let unlistenGap: (() => void) | null = null;
    void onZhuyeEventGap((gap) => {
      if (gap.scope === 'foreground') seqTracker.forceResync();
    }).then((un) => {
      unlistenGap = un;
    });
    return () => {
      unsubscribe();
      unlistenGap?.();
      set({ subscribed: false });
    };
  },

  submit: async (text, workspace) => {
    const id = uuid();
    const submission: ZhuyeSubmission = {
      id,
      op: { type: 'user_input', items: [{ type: 'text', text }], thread_settings: { approval_policy: wireApprovalPolicy(get().loadedSessionId) } },
      ...(workspace ? { workspace } : {}),
    };
    set((state) => ({
      turns: [
        ...state.turns,
        { id, items: [{ kind: 'user_text', text }], status: 'streaming' },
      ],
    }));
    try {
      await zhuye_submit(submission);
    } catch (error) {
      // 提交失败：乐观 turn 落为 aborted 并记录错误。否则它永远停在
      // streaming → selectIsTurnRunning 恒真 → 队列永不排空,整个会话假死。
      set((state) => ({
        turns: markTurn(state.turns, id, 'aborted'),
        lastError: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },

  submitItems: async (items, workspace) => {
    const id = uuid();
    const submission: ZhuyeSubmission = {
      id,
      op: { type: 'user_input', items, thread_settings: { approval_policy: wireApprovalPolicy(get().loadedSessionId) } },
      ...(workspace ? { workspace } : {}),
    };
    const firstText = items.find(
      (item): item is { type: 'text'; text: string } => item.type === 'text',
    );
    // A2:附件不再退化为 "(N attachments)" 占位文本 —— 图片缩略图 /
    // 文件 chip 以 user_attachments item 渲染,发送前后观感一致。
    const attachments = userAttachmentsFromItems(items);
    set((state) => ({
      turns: [
        ...state.turns,
        {
          id,
          items: [
            ...(firstText ? [{ kind: 'user_text' as const, text: firstText.text }] : []),
            ...(attachments.length > 0
              ? [{ kind: 'user_attachments' as const, attachments }]
              : []),
          ],
          status: 'streaming' as const,
        },
      ],
    }));
    try {
      await zhuye_submit(submission);
    } catch (error) {
      // 同 submit:失败回滚乐观 turn,不卡死队列。
      set((state) => ({
        turns: markTurn(state.turns, id, 'aborted'),
        lastError: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },

  interrupt: async () => {
    await zhuye_interrupt();
  },

  steer: async (items, priority) => {
    // 乐观渲染:引擎注入转向消息时不发协议事件(仅落 recorder),这里
    // 把转向文本立即附加到当前运行中的 turn,让用户看到插话已送达。
    const state = get();
    const last = state.turns[state.turns.length - 1];
    if (!last) {
      // 竞态兜底:提交瞬间 turn 已收尾 → 无注入目标,退化为前端排队
      // (下一个 UserInput turn 边界由 drainQueue 送出,语义等价)。
      state.enqueueMessage(items);
      return;
    }
    const firstText = items.find(
      (item): item is { type: 'text'; text: string } => item.type === 'text',
    );
    // 以引用标识乐观项,失败时精确移除(不影响流式增量对其他项的更新)。
    const optimistic: TurnItem = {
      kind: 'user_text',
      text: firstText?.text ?? `(${items.length} attachment${items.length === 1 ? '' : 's'})`,
    };
    set((s) => ({ turns: appendItem(s.turns, last.id, optimistic) }));
    try {
      await zhuye_steer(items, priority);
    } catch (error) {
      set((s) => ({
        turns: s.turns.map((turn) =>
          turn.id === last.id
            ? { ...turn, items: turn.items.filter((item) => item !== optimistic) }
            : turn,
        ),
      }));
      throw error;
    }
  },

  // 应答经 subagent_status 事件异步到达,reducer 写 subagents.lastStatus。
  querySubagents: async (childId) => { await zhuye_query_subagents(childId); },
  interruptSubagent: async (childId) => { await zhuye_interrupt(childId); },
  /**
   * v1.6.1:查询提示词层。应答经 `prompt_list` 事件异步到达,
   * reducer 写入 `prompt`(进程级状态,不随会话切换重置)。
   */
  promptList: async () => {
    await zhuye_prompt_command({ type: 'list' });
  },

  /**
   * v1.6.1:重扫提示词库 —— 用户改了 `.zhuye/prompts/*.md` 后让改动
   * 即时生效。应答经 `prompt_switched` 事件异步到达,reducer 写入
   * `prompt` 并弹 toast。
   */
  promptRescan: async (layer) => {
    await zhuye_prompt_command({ type: 'switch', layer: layer ?? null });
  },
  queryGuardStats: () => runQueryGuardStats(zhuye_query_guard_stats), // F01
  ...createQueueActions(set, get),

  compact: async () => {
    await zhuye_compact();
  },
  rewind: async (toTurnId) => {
    await zhuye_rewind(toTurnId);
  },
  shutdown: async () => {
    await zhuye_shutdown();
  },

  approve: async (kind, id, decision) => {
    if (kind === 'tool') await zhuye_tool_approval(id, decision);
    else await zhuye_hook_approval(id, decision);
    set((state) => ({
      pendingApprovals: state.pendingApprovals.filter((approval) => approval.id !== id),
    }));
  },

  // plan 域 actions(approvePlan / enter / exit / set / cycle)拆至
  // ./planActions 工厂(queue/toast 同款模式)。
  ...createPlanActions(set, get),
  setEffort: async (level) => {
    await zhuye_set_effort(level);
  },
  syncPermissionMode: (mode) => {
    // v1.x:bind 返回值可能携带弃用档(计划批准落盘的 accept_edits),
    // 与 reducer 的 permission_mode_changed 同款归一化,切换器恒三态。
    set({ permissionMode: normalizePermissionMode(mode as PermissionMode) });
  },
  setWorktreeIntent: (intent) => set({ worktreeIntent: intent }),

  answerQuestion: async (id, answers) => {
    await zhuye_ask_user_question_response(id, answers);
    set((state) => ({
      pendingQuestions: state.pendingQuestions.filter((question) => question.id !== id),
    }));
  },

  answerInput: async (id, text) => {
    await zhuye_ask_user_input_response(id, text);
    set((state) => ({
      pendingAskUser: state.pendingAskUser.filter((question) => question.id !== id),
    }));
  },

  /** 回执 MCP elicitation 请求:引擎按 id 解锁 rmcp,本地移除挂起态。 */
  resolveElicitation: async (id, action, content) => {
    await zhuye_mcp_elicitation_response(id, action, content);
    set((state) => ({
      pendingElicitations: state.pendingElicitations.filter((e) => e.id !== id),
    }));
  },

  clearError: () => set({ lastError: null }),
  ...createToastActions(set),

  reset: () => {
    goalSnapshotGeneration += 1;
    planFailover.reset();
    set({
      turns: [],
      session: null,
      loadedSessionId: null,
      worktreeIntent: null, // 草稿级意图全量复位,残留会误走建树链路
      permissionMode: 'auto',
      pendingApprovals: [],
      pendingQuestions: [],
      pendingAskUser: [],
      pendingElicitations: [],
      pendingPlan: null,
      plan: null,
      planDraft: null,
      mcpServers: [],
      lspServers: [],
      lastError: null,
      tokens: null,
      contextWindowSize: null,
      queuedMessages: [],
      collabSessions: [],
      mcpInvocations: [],
      lastRouting: null,
      configReloadedAt: null,
      planFailover: null,
      compactions: { count: 0, removedMessages: 0, tokensSaved: 0, last: null, records: [] },
      toasts: [],
      goalActive: false,
      goalSnapshot: null,
      subagents: EMPTY_SUBAGENTS,
      todos: [],
      planSteps: [],
      loadedPlugins: [],
    });
  },
  };
});
