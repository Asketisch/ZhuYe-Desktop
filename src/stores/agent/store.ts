import { create } from 'zustand';
import { subscribeAgentEvent } from '@/services/agentEventBus';
import type { ReflectEvent, ReflectSubmission } from '@/types/protocol';
import {
  reflect_ask_user_input_response,
  reflect_ask_user_question_response,
  reflect_compact,
  reflect_cycle_permission_mode,
  reflect_enter_plan_mode,
  reflect_exit_plan_mode,
  reflect_get_config,
  reflect_hook_approval,
  reflect_interrupt,
  reflect_plan_approval,
  reflect_prompt_command,
  reflect_query_subagents,
  reflect_rewind,
  reflect_save_config,
  reflect_set_effort,
  reflect_set_permission_mode,
  reflect_shutdown,
  reflect_steer,
  reflect_goal_snapshot,
  reflect_submit,
  reflect_tool_approval,
} from '@/utils/commands';
import { turnsFromRollout } from '../replay';
import {
  createAutoCompactController,
} from './autoCompact';
import {
  createPlanFailoverController,
  extractExhaustionSignal,
  isAutoFailoverEnabled,
} from './planFailover';
import { reduceEvent } from './reducer';
import { appendItem, markTurn } from './turns';
import { selectHasPendingInteraction, selectIsTurnRunning } from './selectors';
import { createToastActions, uuid } from './toast';
import type { AgentState, SubagentsState, TurnItem } from './types';

export const useAgentStore = create<AgentState>((set, get) => {
  // 会话作用域的子代理可观测投影的空态(复用引用,避免每处字面量)。
  const EMPTY_SUBAGENTS: SubagentsState = { feed: [], lastStatus: null };
  let goalSnapshotGeneration = 0;
  // 按 plan 最大上下文自动压缩控制器(内部有开关/节流/触发闩)。
  const autoCompact = createAutoCompactController({
    getConfig: () => reflect_get_config(),
    compact: () => reflect_compact(),
  });
  // coding plan 耗尽自动切换控制器:闭包持有 get/set,防抖状态随 store 生命周期。
  // getConfig/saveConfig 用箭头包装延迟解引用 —— 测试环境部分 mock
  // @/utils/commands 时不至于在 store 构造期就触碰未导出的名字。
  const planFailover = createPlanFailoverController({
    getConfig: () => reflect_get_config(),
    saveConfig: (toml) => reflect_save_config(toml),
    pushToast: (input) => {
      get().pushToast(input);
    },
    isEnabled: isAutoFailoverEnabled,
    onSwitched: (from, to) => set({ planFailover: { from, to, at: Date.now() } }),
    currentProvider: () => get().session?.provider ?? null,
  });

  return {
  turns: [],
  session: null,
  permissionMode: 'auto',
  pendingApprovals: [],
  pendingQuestions: [],
  pendingAskUser: [],
  pendingPlan: null,
  mcpServers: [],
  lspServers: [],
  lastError: null,
  subscribed: false,
  loadedSessionId: null,
  hydrateSession: (id, records) => {
    goalSnapshotGeneration += 1;
    const { turns, compactions } = turnsFromRollout(records);
    const changedSession = get().loadedSessionId !== id;
    // goalActive/goalSnapshot 一并复位:goal 挂在后端线程上,rebind 造新
    // 线程即丢,换会话后旧投影不可信（同 id 重放也复位 —— goal 本就不入盘）。
    // 复位后立即向后端快照校准（reflect_goal_snapshot,v1.7 读口）——
    // 线程确实还挂着 goal 时投影会被拉回 true,不再靠猜。
    // subagents 同为会话作用域投影,replay 的历史不含子代理实时流。
    // token 投影同理:live 的按模型累计(per-model)属于**上一个**会话,
    // 换会话后必须清空 —— 否则 Inspector 的「按模型」会挂着旧会话的行。
    // 落盘侧的累计由 `/usage` 视图按 session id 现查,不受影响。
    set({
      turns,
      compactions,
      loadedSessionId: id,
      ...(changedSession ? {
        pendingApprovals: [], pendingQuestions: [], pendingAskUser: [], pendingPlan: null,
        lastRouting: null,
      } : {}),
      lastError: null,
      queuedMessages: [],
      goalActive: false,
      goalSnapshot: null,
      subagents: EMPTY_SUBAGENTS,
      todos: [],
      planSteps: [],
      tokens: null,
      contextWindowSize: null,
    });
    void get().syncGoalSnapshot();
  },
  clearSession: () => {
    goalSnapshotGeneration += 1;
    set({
      turns: [],
      loadedSessionId: null,
      pendingApprovals: [],
      pendingQuestions: [],
      pendingAskUser: [],
      pendingPlan: null,
      queuedMessages: [],
      // 会话域的遥测/路由数据一并重置:回到首页(或新会话首事件到来前)
      // 不应展示上一个会话的 token/压缩/路由;planFailover 的
      // currentProvider 兜底也不应读到旧会话的 provider。
      session: null,
      tokens: null,
      contextWindowSize: null,
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
  // 提示词层状态(v1.6.1)—— 进程级,不随会话切换重置。
  prompt: null,
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
      const snapshot = await reflect_goal_snapshot();
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
    const unsubscribe = subscribeAgentEvent((event: ReflectEvent) => {
      const patch = reduceEvent(get(), event);
      if (Object.keys(patch).length > 0) set(patch);
      // C：turn 收尾后自动排空跟进队列（reduce 完成后再取最新状态判断）。
      if (event.msg.type === 'turn_complete' || event.msg.type === 'turn_aborted') {
        void get().drainQueue();
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
      // plan 最大上下文 ≥80% → 自动压缩（内部有开关/节流/触发闩）。
      if (event.msg.type === 'token_count') {
        void autoCompact(event.msg.input_tokens ?? 0);
      }
    });
    return () => {
      unsubscribe();
      set({ subscribed: false });
    };
  },

  submit: async (text, workspace) => {
    const id = uuid();
    const submission: ReflectSubmission = {
      id,
      op: { type: 'user_input', items: [{ type: 'text', text }] },
      ...(workspace ? { workspace } : {}),
    };
    set((state) => ({
      turns: [
        ...state.turns,
        { id, items: [{ kind: 'user_text', text }], status: 'streaming' },
      ],
    }));
    try {
      await reflect_submit(submission);
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
    const submission: ReflectSubmission = {
      id,
      op: { type: 'user_input', items },
      ...(workspace ? { workspace } : {}),
    };
    const firstText = items.find(
      (item): item is { type: 'text'; text: string } => item.type === 'text',
    );
    set((state) => ({
      turns: [
        ...state.turns,
        {
          id,
          items: firstText
            ? [{ kind: 'user_text' as const, text: firstText.text }]
            : [
                {
                  kind: 'user_text' as const,
                  text: `(${items.length} attachment${items.length === 1 ? '' : 's'})`,
                },
              ],
          status: 'streaming' as const,
        },
      ],
    }));
    try {
      await reflect_submit(submission);
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
    await reflect_interrupt();
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
      await reflect_steer(items, priority);
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
  querySubagents: async (childId) => { await reflect_query_subagents(childId); },
  interruptSubagent: async (childId) => { await reflect_interrupt(childId); },
  /**
   * v1.6.1:查询提示词层。应答经 `prompt_list` 事件异步到达,
   * reducer 写入 `prompt`(进程级状态,不随会话切换重置)。
   */
  promptList: async () => {
    await reflect_prompt_command({ type: 'list' });
  },

  /**
   * v1.6.1:重扫提示词库 —— 用户改了 `.zhuye/prompts/*.md` 后让改动
   * 即时生效。应答经 `prompt_switched` 事件异步到达,reducer 写入
   * `prompt` 并弹 toast。
   */
  promptRescan: async (layer) => {
    await reflect_prompt_command({ type: 'switch', layer: layer ?? null });
  },

  enqueueMessage: (items, workspace) => {
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
          createdAt: Date.now(),
        },
      ],
    }));
  },

  removeQueued: (id) => {
    set((state) => ({ queuedMessages: state.queuedMessages.filter((m) => m.id !== id) }));
  },

  updateQueued: (id, text) => {
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
    if (state.queuedMessages.length === 0) return;
    if (selectIsTurnRunning(state)) return;
    // 审批/提问/输入/plan 等待中 → 暂停排空，处理完后由下一次事件再触发。
    if (selectHasPendingInteraction(state)) return;
    const [next, ...rest] = state.queuedMessages;
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

  compact: async () => {
    await reflect_compact();
  },
  rewind: async (toTurnId) => {
    await reflect_rewind(toTurnId);
  },
  shutdown: async () => {
    await reflect_shutdown();
  },

  approve: async (kind, id, decision) => {
    if (kind === 'tool') await reflect_tool_approval(id, decision);
    else await reflect_hook_approval(id, decision);
    set((state) => ({
      pendingApprovals: state.pendingApprovals.filter((approval) => approval.id !== id),
    }));
  },

  // plan 审批走独立的 approvePlan —— PlanApprovalChoice 三选一,语义与
  // tool/hook 的 ReviewDecision 不同,故单独方法。
  approvePlan: async (id, choice) => {
    await reflect_plan_approval(id, choice);
    set((state) => state.pendingPlan?.id === id && state.pendingPlan.kind === 'request'
      ? { pendingPlan: null }
      : {});
  },

  enterPlanMode: async (task) => {
    await reflect_enter_plan_mode(task);
  },
  exitPlanMode: async () => {
    await reflect_exit_plan_mode();
  },
  setEffort: async (level) => {
    await reflect_set_effort(level);
  },
  setPermissionMode: async (mode) => {
    await reflect_set_permission_mode(mode);
  },
  cyclePermissionMode: async () => {
    await reflect_cycle_permission_mode();
  },
  syncPermissionMode: (mode) => {
    set({ permissionMode: mode });
  },

  answerQuestion: async (id, answers) => {
    await reflect_ask_user_question_response(id, answers);
    set((state) => ({
      pendingQuestions: state.pendingQuestions.filter((question) => question.id !== id),
    }));
  },

  answerInput: async (id, text) => {
    await reflect_ask_user_input_response(id, text);
    set((state) => ({
      pendingAskUser: state.pendingAskUser.filter((question) => question.id !== id),
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
      permissionMode: 'auto',
      pendingApprovals: [],
      pendingQuestions: [],
      pendingAskUser: [],
      pendingPlan: null,
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
