import type { ZhuyeEvent } from '@/types/protocol';
import { normalizePermissionMode } from '@/types/protocol';
import type { AgentState, CompactionRecord, PendingApproval, PlanStepState, PluginLoadedInfo, TodoItem } from './types';
import { COMPACTION_RECORD_CAP, SUBAGENT_FEED_CAP } from './types';
import { upsertServer } from './servers';
import {
  abortTurnOrLatestStreaming,
  appendItem,
  EVENT_ID_NONE,
  finalizeAssistantText,
  markTurn,
  resetStreamingOutput,
  summarizeArgs,
  summarizeToolOutput,
  upsertDelta,
  upsertThinking,
} from './turns';

export function reduceEvent(state: AgentState, event: ZhuyeEvent): Partial<AgentState> {
  const { msg } = event;
  const turnId = event.id;
  const isSessionEvent = turnId === EVENT_ID_NONE;

  switch (msg.type) {
    case 'session_configured': {
      const patch: Partial<AgentState> = {};
      if (msg.model) patch.session = { model: msg.model, provider: msg.provider };
      if (typeof msg.context_window_size === 'number') {
        patch.contextWindowSize = msg.context_window_size;
      }
      return patch;
    }

    case 'turn_started':
      if (state.turns.some((turn) => turn.id === turnId)) return {};
      return { turns: [...state.turns, { id: turnId, items: [], status: 'streaming' }] };

    case 'turn_complete':
      return {
        turns: markTurn(state.turns, turnId, 'done'),
        ...(isSessionEvent ? {} : {
          pendingApprovals: state.pendingApprovals.filter((item) => item.turnId !== turnId),
          pendingQuestions: state.pendingQuestions.filter((item) => item.turnId !== turnId),
          pendingAskUser: state.pendingAskUser.filter((item) => item.turnId !== turnId),
        }),
      };

    case 'turn_aborted':
      return {
        // id 匹配不到时兜底终结最后一个 streaming turn —— 引擎空闲期
        // 中断回执的 turn_id 是现编的,按 id 配对会落空,表现为停止
        // 按钮点了没反应(v1.10)。
        turns: abortTurnOrLatestStreaming(state.turns, turnId),
        ...(isSessionEvent ? {} : {
          pendingApprovals: state.pendingApprovals.filter((item) => item.turnId !== turnId),
          pendingQuestions: state.pendingQuestions.filter((item) => item.turnId !== turnId),
          pendingAskUser: state.pendingAskUser.filter((item) => item.turnId !== turnId),
          ...(state.pendingPlan?.turnId === turnId ? { pendingPlan: null } : {}),
        }),
      };

    case 'turn_rewound': {
      const cutoff = msg.to_turn_id;
      if (!cutoff) return {};
      // 引擎 `truncate_after(to_turn_id)` 丢弃该 turn **含**及其之后的
      // 记录(recorder.rs),本地截断必须同语义:只保留出现在该 turn
      // *之前*的 turn。v4 UUID 无法字典序比较,改为查找索引。若 id 未知
      // 则保持 turns 不动(后端是单一事实源,下一次回放会重新对齐)。
      const idx = state.turns.findIndex((turn) => turn.id === cutoff);
      if (idx < 0) return {};
      return { turns: state.turns.slice(0, idx) };
    }

    case 'shutdown_complete':
      return { lastError: 'agent shut down' };

    // v1.3 SDK serve 模式的 per-submission 通道排空标记。Desktop 内嵌
    // AgentThread 不发本事件(收尾由 turn_complete / turn_aborted 承担);
    // 类型联合补齐后此处 no-op,保住上方穷尽性守卫。
    case 'submission_closed':
      return {};

    case 'agent_message_delta':
      return msg.delta ? { turns: upsertDelta(state.turns, turnId, msg.delta) } : {};

    // v1.10:模型流式调用失败将自动重试 —— 清掉本 turn 的半成品输出
    // (文本 / thinking / 未完成工具调用),等待重试的全新输出,防止
    // 两次输出拼接。已完成步骤(工具结果)保留。
    case 'agent_message_reset':
      return { turns: resetStreamingOutput(state.turns, turnId) };

    case 'agent_message':
      return { turns: finalizeAssistantText(state.turns, turnId, msg.text) };

    case 'thinking_delta':
      return msg.delta
        ? {
            turns: upsertThinking(
              state.turns,
              turnId,
              msg.delta,
              msg.kind === 'summary' ? 'summary' : 'raw',
            ),
          }
        : {};

    case 'token_count': {
      // v1.x 模型级统计:按 model 分组累计,让 GUI 能回答「各模型花了多少」。
      // 旧引擎不上报 model → byModel 保持为空(不编造归属)。
      const model = msg.model ?? null;
      const prevByModel = state.tokens?.byModel ?? {};
      const byModel: NonNullable<AgentState['tokens']>['byModel'] = { ...prevByModel };
      if (model) {
        const cur = prevByModel[model];
        byModel[model] = {
          model,
          provider: msg.provider ?? cur?.provider ?? null,
          calls: (cur?.calls ?? 0) + 1,
          input: (cur?.input ?? 0) + msg.input_tokens,
          output: (cur?.output ?? 0) + msg.output_tokens,
          cached: (cur?.cached ?? 0) + msg.cached_tokens,
          cacheWrite: (cur?.cacheWrite ?? 0) + msg.cache_write_tokens,
          total: (cur?.total ?? 0) + msg.total_tokens,
          cost: (cur?.cost ?? 0) + (msg.cost_usd ?? 0),
        };
      }
      return {
        tokens: {
          input: msg.input_tokens,
          output: msg.output_tokens,
          cached: msg.cached_tokens,
          cacheWrite: msg.cache_write_tokens,
          total: msg.total_tokens,
          provider: msg.provider ?? null,
          credentialLabel: msg.credential_label ?? null,
          // v1.x 模型级统计:本轮实际命中的模型 spec。旧引擎不上报 → null。
          model: msg.model ?? null,
          // 费用:引擎按模型价目算好随事件携带;未定价模型为 null。
          // sessionCost 只累计 live 事件,回放 hydrate 不重复计费。
          cost: msg.cost_usd ?? null,
          sessionCost: (state.tokens?.sessionCost ?? 0) + (msg.cost_usd ?? 0),
          // 会话累计 total(区别于 `total` = 最后一次调用的 total)。
          sessionTotal: (state.tokens?.sessionTotal ?? 0) + msg.total_tokens,
          byModel,
        },
      };
    }

    case 'tool_call_begin':
      return {
        turns: appendItem(state.turns, turnId, {
          kind: 'tool_call',
          toolName: msg.tool_name,
          callId: msg.call_id,
          argsSummary: summarizeArgs(msg.args),
          status: 'running',
        }),
      };

    case 'tool_call_args_delta': {
      // v1.5:流式工具参数增量 —— 按 call_id 累积到对应 tool_call 条目,
      // 模型生成参数期间渐进渲染(begin 先建条目且 args 为 null,这是
      // 生成期间唯一的输入可见来源)。整包形态的 provider 不发本事件。
      // 找不到条目(乱序/回放)时保持原 turns,与未知事件同等宽容。
      const hasCall = state.turns.some(
        (turn) =>
          turn.id === turnId &&
          turn.items.some((i) => i.kind === 'tool_call' && i.callId === msg.call_id),
      );
      if (!hasCall) return {};
      return {
        turns: state.turns.map((turn) => {
          if (turn.id !== turnId) return turn;
          return {
            ...turn,
            items: turn.items.map((item) =>
              item.kind === 'tool_call' && item.callId === msg.call_id
                ? { ...item, argsStream: (item.argsStream ?? '') + msg.delta }
                : item,
            ),
          };
        }),
      };
    }

    case 'tool_call_end': {
      const summary = summarizeToolOutput(msg.output);
      const withOutput = appendItem(state.turns, turnId, {
        kind: 'tool_output',
        callId: msg.call_id,
        text: summary.text,
        diff: summary.diff,
        path: summary.path,
        isError: msg.is_error,
        // F01:注入标注 —— guard 的 Review 裁决把 verdict 写进输出元数据,
        // 消息流据此渲染 🛡 徽标(block 裁决正文已是拦截提示,同样标注)。
        guardVerdict: extractGuardVerdict(msg.output?.metadata),
      });
      // TodoWrite 工具把 todo 清单放在 `output.metadata.todos` —— 事件流里
      // 就有。上游 zhuye-core 已把清单回灌进模型上下文(todos_slot +
      // pre_loop 注入);GUI 侧提取进 store.todos 驱动右上角清单与检查器。
      const patch: Partial<AgentState> = {};
      const turnOfCall = withOutput.find((t) => t.id === turnId);
      const toolCall = turnOfCall?.items.find(
        (i): i is Extract<typeof i, { kind: 'tool_call' }> =>
          i.kind === 'tool_call' && i.callId === msg.call_id,
      );
      // 外部文件回复或取消也会结束工具，不一定经过本地弹窗的提交动作。
      if (toolCall?.toolName === 'ask_user' || toolCall?.toolName === 'request_human_input') {
        patch.pendingAskUser = state.pendingAskUser.filter((item) => item.turnId !== turnId);
      } else if (toolCall?.toolName === 'ask_user_question') {
        patch.pendingQuestions = state.pendingQuestions.filter((item) => item.turnId !== turnId);
      }
      if (toolCall?.toolName === 'TodoWrite') {
        const todos = extractTodos(msg.output.metadata);
        if (todos) patch.todos = todos;
      }
      // 只重写拥有对应 tool_call 的 turn,其他 turn 重写毫无意义。
      const targetTurnIdx = withOutput.findIndex((t) => t.id === turnId);
      if (targetTurnIdx < 0) return { turns: withOutput, ...patch };
      const target = withOutput[targetTurnIdx];
      const nextStatus: 'done' | 'error' = msg.is_error ? 'error' : 'done';
      const updatedTurn = {
        ...target,
        items: target.items.map((item) =>
          item.kind === 'tool_call' && item.callId === msg.call_id
            ? { ...item, status: nextStatus }
            : item,
        ),
      };
      const turns = withOutput.slice();
      turns[targetTurnIdx] = updatedTurn;
      return { turns, ...patch };
    }

    case 'tool_execution_request':
      // v1.3 SDK serve 模式:core 请求客户端本地执行注册的远程工具。
      // Desktop 内嵌 AgentThread,不注册远程工具,不会收到;保穷尽 no-op。
      return {};

    case 'tool_call_output_delta':
      // v1.4 A3:工具输出流式增量(预览;最终完整输出仍以 tool_call_end
      // 为准,该 case 已按 end 全量重写)。GUI 暂不做实时流式追加,先
      // 保穷尽 no-op,避免长命令期间高频重渲染。
      return {};

    case 'subagent_progress': {
      // v1.4 C1 通道一:子代理进度推送 → Inspector 子代理区块的滚动
      // feed(封顶丢弃最旧,防长会话无界增长)。
      const entry = {
        id: event.id,
        childId: msg.child_id,
        role: msg.role,
        kind: msg.kind,
        text: msg.text,
        at: Date.now(),
      };
      const feed = [...state.subagents.feed, entry];
      return {
        subagents: {
          ...state.subagents,
          feed: feed.length > SUBAGENT_FEED_CAP ? feed.slice(-SUBAGENT_FEED_CAP) : feed,
        },
      };
    }

    case 'subagent_status':
      // v1.4 C1 通道二:Op::QuerySubagents 的应答快照 → Inspector 展示。
      return { subagents: { ...state.subagents, lastStatus: msg.children } };

    // v1.x WP9:side-channel 生命周期/快照**不写 agent 状态投影** —— 唯一
    // 消费方 SideChannelView 直接订阅 agentEventBus 即时失效 react-query
    // 缓存(进程级注册表在后端共享,与 store 无关)。case 仅维护穷尽性
    // 守卫;曾有的 lastSnapshot/revision 字段无生产消费方,已删。
    case 'side_channel_started':
    case 'side_channel_finished':
    case 'side_channel_status':
      return {};

    case 'approval_request': {
      // plan 类型的审批走独立的 plan_ready 事件 + pendingPlan + PlanReadyModal,
      // 不进 pendingApprovals(后者只收 tool / hook)。
      if (msg.kind.type === 'plan') return {};
      const approval: PendingApproval = {
        id: msg.request_id,
        kind: msg.kind.type,
        toolName: msg.kind.type === 'tool' ? msg.kind.tool_name : undefined,
        argsSummary: msg.kind.type === 'tool' ? summarizeArgs(msg.kind.args) : undefined,
        // 原始参数:审批弹窗要据此推导「始终允许这条命令」的匹配模式。
        args: msg.kind.type === 'tool' ? msg.kind.args : undefined,
        // F06:风险标签透传(引擎 approval_request 事件的 risk 字段),
        // 审批卡据此渲染风险徽标。
        risk: msg.risk,
        turnId,
      };
      return { pendingApprovals: [...state.pendingApprovals, approval] };
    }

    case 'ask_user_question':
      return {
        pendingQuestions: [
          ...state.pendingQuestions,
          { id: msg.request_id, payload: msg, turnId },
        ],
      };

    case 'ask_user_input':
      return {
        pendingAskUser: [
          ...state.pendingAskUser,
          { id: msg.request_id, payload: msg, turnId },
        ],
      };

    case 'permission_bubble': {
      // Bubble 模式：core 已自动批准该工具（非高危），事件只是非阻塞
      // 通知 —— 用 toast 展示。不能进 pendingApprovals：那会渲染成
      // blocking modal，而 bubble payload 没有 request_id，modal 无法
      // 真正应答，只会永久悬挂。
      const preview = msg.args_preview ? `(${msg.args_preview})` : '';
      const toast: AgentState['toasts'][number] = {
        id: `bubble-${msg.tool_name}-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
        kind: 'info',
        message: `已自动批准 ${msg.tool_name}${preview}`,
        ttlMs: 4000,
        createdAt: Date.now(),
      };
      return { toasts: [...state.toasts, toast] };
    }

    case 'context_compacted': {
      // 压缩不进对话流（噪声），聚合到 Inspector 概览。后端对无变化的
      // 压缩仍会发事件（noop 守卫只管落盘），这里跳过 before == after
      // 且无消息移除的空压缩。
      if (msg.before_tokens === msg.after_tokens && msg.removed_messages === 0) return {};
      const saved = Math.max(0, msg.before_tokens - msg.after_tokens);
      const prev = state.compactions;
      const record: CompactionRecord = {
        strategy: msg.strategy,
        removedMessages: msg.removed_messages,
        beforeTokens: msg.before_tokens,
        afterTokens: msg.after_tokens,
        tokensSaved: saved,
        at: Date.now(),
      };
      return {
        compactions: {
          count: prev.count + 1,
          removedMessages: prev.removedMessages + msg.removed_messages,
          tokensSaved: prev.tokensSaved + saved,
          last: `${msg.strategy}: ${msg.removed_messages} msgs (${msg.before_tokens} → ${msg.after_tokens} tokens)`,
          // 逐次明细(新到旧,封顶防无界增长)。
          records: [record, ...(prev.records ?? [])].slice(0, COMPACTION_RECORD_CAP),
        },
      };
    }

    case 'error':
      return isSessionEvent
        ? { lastError: `${msg.code}: ${msg.message}` }
        : {
            turns: appendItem(state.turns, turnId, {
              kind: 'error',
              text: `${msg.code}: ${msg.message}`,
            }),
          };

    case 'stream_error': {
      const text =
        msg.message || `stream error ${msg.code} (retry in ${msg.retry_in_ms}ms)`;
      return isSessionEvent
        ? { lastError: text }
        : { turns: appendItem(state.turns, turnId, { kind: 'error', text }) };
    }

    case 'config_reloaded':
      return { configReloadedAt: Date.now() };

    // v1.6.1:提示词层查询应答 —— `Op::PromptCommand { action: List }`。
    // 会话级提示词选择和当前生效方案。
    case 'prompt_list':
      return {
        prompt: {
          available: msg.available,
          currentSpec: msg.current_spec,
          activeLayers: msg.active_layers,
          selection: msg.selection,
          profile: msg.profile,
          fallbackReason: msg.fallback_reason,
          switchedAt: state.prompt?.switchedAt ?? null,
        },
      };

    // v1.6.1:提示词库重扫完成 —— 立即 toast 提示「提示词已刷新」并
    // 展示新命中层(协议约定由 UI 提示)。
    case 'prompt_switched': {
      const toast: AgentState['toasts'][number] = {
        id: `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: 'info',
        message:
          msg.active_layers.length > 0
            ? `提示词已刷新,生效层:${msg.active_layers.join(', ')}`
            : '提示词已刷新',
        ttlMs: 4000,
        createdAt: Date.now(),
      };
      return {
        prompt: {
          available: state.prompt?.available ?? [],
          currentSpec: state.prompt?.currentSpec ?? '',
          activeLayers: msg.active_layers,
          selection: msg.selection,
          profile: msg.profile,
          fallbackReason: msg.fallback_reason,
          switchedAt: Date.now(),
        },
        toasts: [...state.toasts, toast],
      };
    }

    // F01:prompt_guard 裁决统计应答 —— 进程级状态(guard 挂在引擎进程,
    // 切会话不清零),设置页安全段据此展示「开了没 / 拦了多少」。
    case 'guard_stats':
      return {
        guardStats: {
          enabled: msg.enabled,
          definitionsBlocked: msg.definitions_blocked,
          definitionsReviewed: msg.definitions_reviewed,
          outputsBlocked: msg.outputs_blocked,
          outputsReviewed: msg.outputs_reviewed,
        },
      };

    // v1.x(submodule main):运行时扩展重扫完成 —— toast 提示「skills
    // 已刷新」并展示条目总数(协议约定由 UI 提示,与 prompt_switched 同款)。
    case 'extensions_rescanned': {
      const toast: AgentState['toasts'][number] = {
        id: `rescan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: 'info',
        message: `skills 已刷新,共 ${msg.skills} 条`,
        ttlMs: 4000,
        createdAt: Date.now(),
      };
      return { toasts: [...state.toasts, toast] };
    }

    case 'routing':
      return {
        lastRouting: {
          kind: msg.kind,
          role: msg.role,
          from: msg.from_credential,
          to: msg.to_credential,
          reason: msg.reason,
        },
      };

    case 'collab_started':
      return {
        collabSessions: [
          ...state.collabSessions,
          {
            id: msg.id,
            participants: msg.participants,
            mode: msg.mode,
            startedAt: Date.now(),
            status: 'running',
            messages: [],
          },
        ],
      };

    case 'collab_message':
      return {
        collabSessions: state.collabSessions.map((session) =>
          session.id === msg.id
            ? {
                ...session,
                messages: [
                  ...session.messages,
                  {
                    from: msg.from,
                    kind: msg.kind,
                    content: msg.content,
                    round: msg.round,
                    at: Date.now(),
                  },
                ],
              }
            : session,
        ),
      };

    case 'collab_finished':
      return {
        collabSessions: state.collabSessions.map((session) =>
          session.id === msg.id
            ? {
                ...session,
                status: msg.outcome === 'failed' ? 'failed' as const
                  : msg.outcome === 'cancelled' ? 'cancelled' as const : 'done' as const,
                outcome: msg.outcome,
                rounds: msg.rounds,
              }
            : session,
        ),
      };

    case 'mcp_server_started':
      return {
        mcpServers: upsertServer(
          state.mcpServers,
          msg.server,
          'started',
          `${msg.tool_count} tools`,
        ),
      };

    case 'mcp_server_failed':
      return {
        mcpServers: upsertServer(state.mcpServers, msg.server, 'failed', msg.error),
      };

    case 'mcp_tool_invoked':
      return {
        mcpInvocations: [
          ...state.mcpInvocations,
          { server: msg.server, tool: msg.tool, callId: msg.call_id, at: Date.now() },
        ].slice(-50),
      };

    case 'lsp_server_started':
      return {
        lspServers: upsertServer(
          state.lspServers,
          msg.server,
          'started',
          `${msg.methods.length} methods`,
        ),
      };

    case 'lsp_server_failed':
      return {
        lspServers: upsertServer(state.lspServers, msg.server, 'failed', msg.error),
      };

    case 'plan_request':
      // 新一轮 plan 编排开始 → 上一份草稿作废(终稿保留到新 plan_ready)。
      return {
        pendingPlan: { id: msg.plan_id, kind: 'request', payload: msg, turnId },
        planDraft: null,
      };

    case 'plan_ready':
      // 新 plan → 上一份执行进度作废(step 进度按 plan_id 归属)。
      // 终稿同步写入 `plan`(Inspector 计划 tab 正文,含决策后查看)。
      return {
        pendingPlan: { id: msg.plan_id, kind: 'ready', payload: msg, turnId },
        planSteps: [],
        plan: {
          planId: msg.plan_id,
          markdown: msg.markdown,
          path: msg.path ?? null,
          status: 'ready',
        },
        planDraft: null,
      };

    case 'plan_approved':
    case 'plan_rejected': {
      const patch: Partial<AgentState> = {};
      if (state.pendingPlan?.id === msg.plan_id) patch.pendingPlan = null;
      // 决策只改状态标注,正文保留 —— 用户在批准/拒绝后仍需查看 plan。
      if (state.plan?.planId === msg.plan_id) {
        patch.plan = { ...state.plan, status: msg.type === 'plan_approved' ? 'approved' : 'rejected' };
      }
      return patch;
    }

    case 'plan_draft_updated':
      // plan 草稿覆盖式更新 —— Inspector 计划 tab 实时预览 agent 正在写的
      // plan 文件(此前 GUI 丢弃此事件,plan 模式下右栏永远空)。
      return { planDraft: { markdown: msg.markdown, path: msg.path ?? null } };

    case 'plan_step': {
      // plan 执行进度 —— 核心语义「按 index 就地更新或追加」。
      // 换 plan(plan_id 变)时丢弃上一份进度。
      const planId = String(msg.plan_id);
      const base = state.planSteps[0]?.planId === planId ? state.planSteps : [];
      const step: PlanStepState = {
        index: msg.index,
        total: msg.total,
        status: msg.status,
        title: msg.title ?? null,
        planId,
      };
      const at = base.findIndex((s) => s.index === msg.index);
      const steps = at >= 0 ? base.slice() : [...base, step];
      if (at >= 0) steps[at] = { ...steps[at], ...step };
      steps.sort((a, b) => a.index - b.index);
      return { planSteps: steps };
    }

    case 'permission_mode_changed':
      // v1.x 修复:模式被切换(用户手动接管或审批自身翻转)时清掉悬挂的
      // plan 弹窗 —— 配合上游「手动切模式 cancel_all 在途审批 waiter」,
      // 迟到的审批决策不再二次翻转模式覆盖用户设置。
      // v1.x:弃用档归一化 —— 引擎计划批准 auto_mode 会切到弃用的
      // accept_edits,如实回显会出现第四态;归一为三态(auto/prompt/plan)。
      return {
        permissionMode: normalizePermissionMode(msg.to),
        ...(state.pendingPlan ? { pendingPlan: null } : {}),
      };

    case 'plugin_loaded': {
      // 保留观察到的加载事件；当前状态由插件列表命令提供。
      const info: PluginLoadedInfo = {
        plugin: msg.plugin,
        scope: msg.scope ?? '',
        version: msg.version ?? '',
        skillCount: msg.skill_count ?? 0,
        commandCount: msg.command_count ?? 0,
        at: Date.now(),
      };
      const at = state.loadedPlugins.findIndex((p) => p.plugin === info.plugin);
      const loadedPlugins = at >= 0 ? state.loadedPlugins.slice() : [...state.loadedPlugins, info];
      if (at >= 0) loadedPlugins[at] = info;
      return { loadedPlugins };
    }

    case 'quota_exhausted': {
      // 配额耗尽 → 立即 toast warn,告知用户 agent 因此停止。
      const usedStr = msg.used_tokens && msg.max_tokens
        ? ` (${msg.used_tokens}/${msg.max_tokens} tokens)`
        : '';
      const cooldownStr = msg.window_ends_secs
        ? ` — ${Math.ceil(msg.window_ends_secs / 60)}min 后重置`
        : '';
      const toast: AgentState['toasts'][number] = {
        id: `quota-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: 'warn',
        message: `配额耗尽:${msg.provider}/${msg.label}${usedStr}${cooldownStr}`,
        ttlMs: 6000,
        createdAt: Date.now(),
      };
      return { toasts: [...state.toasts, toast] };
    }

    default: {
      // 穷尽性守卫:联合类型新增变体而上方无对应 case 时,此赋值编译报错,
      // 提醒补 case。运行时(submodule 已发新事件、前端类型未同步)走到
      // 这里则安全返回空 patch —— 调用方(store.subscribe)对 patch 做
      // Object.keys 展开,返回 undefined 会抛 TypeError 中断事件处理。
      const _exhaustive: never = msg;
      void _exhaustive;
      return {};
    }
  }
}

/**
 * 从 `TodoWrite` 工具的输出元数据里取 todo 清单。
 *
 * 核心的 `TodoWrite` 把清单放进 `ToolOutput.metadata.todos`
 * (`{ content, status, activeForm }`);agent 每次调用**整体覆盖**上一轮。
 * 元数据形状不对 → 返回 null(不是空数组)—— 区分「没有清单」与「清单为空」。
 *
 * 注:核心 `TodoRow` 带 `#[serde(rename_all = "camelCase")]`,所以线上
 * 字段是 `activeForm` 而非 `active_form`;这里同时接受两种写法。
 */
function extractTodos(metadata: unknown): TodoItem[] | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const todos = (metadata as { todos?: unknown }).todos;
  if (!Array.isArray(todos)) return null;
  const out: TodoItem[] = [];
  for (const row of todos) {
    if (!row || typeof row !== 'object') continue;
    const r = row as { content?: unknown; status?: unknown; activeForm?: unknown; active_form?: unknown };
    if (typeof r.content !== 'string' || !r.content) continue;
    const activeForm = typeof r.activeForm === 'string' ? r.activeForm : r.active_form;
    out.push({
      content: r.content,
      status: typeof r.status === 'string' ? r.status : 'pending',
      active_form: typeof activeForm === 'string' ? activeForm : null,
    });
  }
  return out;
}

/**
 * F01:从工具输出元数据里取 prompt_guard 裁决标注。
 *
 * 引擎的 prompt_guard 在 Review/Block 裁决时把
 * `{ prompt_guard: { verdict: "review" | "block", ... } }` 写进
 * `ToolOutput.metadata`;Allow / guard 关闭时不写。形状不对或无标注
 * 返回 undefined(与「guard 放行」不可区分,都无需渲染徽标)。
 */
function extractGuardVerdict(metadata: unknown): 'review' | 'block' | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const guard = (metadata as { prompt_guard?: unknown }).prompt_guard;
  if (!guard || typeof guard !== 'object') return undefined;
  const verdict = (guard as { verdict?: unknown }).verdict;
  if (verdict === 'review' || verdict === 'block') return verdict;
  return undefined;
}
