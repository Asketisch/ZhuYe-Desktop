import type {
  AskUserAnswer,
  CompositionCategory,
  PendingGateSnapshot,
  SubagentStatusSnapshot,
  UserInputItem,
} from '@/types/protocol';
import type {
  PendingApproval,
  PendingAskUser,
  PendingElicitation,
  PendingPlan,
  PendingQuestion,
} from './pendingTypes';

export type { PendingApproval, PendingAskUser, PendingPlan, PendingQuestion };
import type { GoalSnapshotPayload } from '@/utils/commands/goal';
import type { PlanApprovalChoice, ZhuyeRolloutRecord, ReviewDecision } from '@/utils/types';
import type { TokenSnapshot } from './tokenTypes';

// token 计量类型已拆到 `./tokenTypes`(本文件逼近 500 行预算)。
// 这里重新导出 —— 既有导入路径(`@/stores/agent/types`)全部保持有效。
export type { LiveModelUsage, TokenSnapshot, TurnTokenUsage } from './tokenTypes';

/**
 * A2 附件元数据类型拆到 `./attachmentTypes`(单文件行数预算,先例同
 * `./tokenTypes`)—— 这里 re-export,既有导入路径保持有效。
 */
export type { UserAttachmentMeta } from './attachmentTypes';
import type { UserAttachmentMeta } from './attachmentTypes';

export type TurnItem =
  | { kind: 'user_text'; text: string }
  | { kind: 'user_attachments'; attachments: UserAttachmentMeta[] }
  | { kind: 'assistant_text'; text: string; streaming?: boolean }
  | {
      kind: 'thinking';
      text: string;
      /**
       * F50:思考增量的语义类型(镜像引擎 `ThinkingDeltaKind`)。
       * `raw` = token 级流式(默认);`summary` = 推理摘要 —— 语义不同的
       * 两种内容,渲染与折叠策略分开(摘要带「推理摘要」标签)。
       */
      variant?: 'raw' | 'summary';
    }
  | {
      kind: 'tool_call';
      toolName: string;
      argsSummary: string;
      callId: string;
      status: 'running' | 'done' | 'error';
      /** v1.5 `tool_call_args_delta` 累积的原始参数(流式 provider 生成期间唯一可展示的参数文本)。 */
      argsStream?: string;
    }
  | {
      kind: 'tool_output';
      callId: string;
      text: string;
      isError: boolean;
      /** edit/write 类工具产出的 unified diff（ContentBlock::Diff），无则为空。 */
      diff?: string;
      /** 工具输出的目标文件路径（metadata.path），无则为空。 */
      path?: string;
      /**
       * F01:prompt_guard 裁决标注（`metadata.prompt_guard.verdict`）。
       * `review` = 输出含可疑注入话术（正文保留、已标注）；
       * `block` = 输出被整体拦截替换。无标注（guard 放行/未启用）为空。
       */
      guardVerdict?: 'review' | 'block';
    }
  | { kind: 'error'; text: string };

/**
 * context_compacted 聚合统计 —— Inspector 概览展示（不再逐条插入对话流）。
 * 历史回放（rollout compaction record）只带 strategy / removed_count，
 * 因此 `tokensSaved` 仅累计 live 事件携带的 before − after。
 */
export interface CompactionStats {
  /** 触发次数（无变化的 noop 事件不计）。 */
  count: number;
  /** 累计移除消息数。 */
  removedMessages: number;
  /** 累计节省的估算 token（Σ before − after；回放 hydrate 的历史不含）。 */
  tokensSaved: number;
  /** 最近一次摘要（strategy + msgs + tokens）。 */
  last: string | null;
  /**
   * 逐次压缩明细（新到旧，封顶 50 条防长会话无界增长）。
   *
   * 让「压缩到底省了多少」可核对 —— 不再只有一行 hover 摘要。
   */
  records: CompactionRecord[];
}

/** 单次压缩的明细。 */
export interface CompactionRecord {
  /** 压缩策略（如 `smart_prune` / `microcompact`）。 */
  strategy: string;
  /** 移除的消息数。 */
  removedMessages: number;
  /** 压缩前上下文 token 估算。 */
  beforeTokens: number;
  /** 压缩后上下文 token 估算。 */
  afterTokens: number;
  /** 节省的 token（before − after）。 */
  tokensSaved: number;
  /** 发生时间（ms）。 */
  at: number;
}

/** 压缩明细封顶条数。 */
export const COMPACTION_RECORD_CAP = 50;

export type TurnStatus = 'streaming' | 'done' | 'aborted';

export interface Turn {
  id: string;
  items: TurnItem[];
  status: TurnStatus;
}

// 队列条目类型拆到 `./queueTypes`（本文件已达行数预算）—— 这里
// re-export，既有导入路径（`@/stores/agent/types`）保持有效。
export type { QueuedMessage } from './queueTypes';
import type { QueuedMessage } from './queueTypes';


/**
 * plan 终稿文档(Inspector「计划」tab 正文)。来源:`plan_ready` 事件(live)
 * 或会话重放的最后一条 `plan_ready` record;决策只改状态标注、正文保留。
 */
export interface PlanDocState {
  planId: string;
  markdown: string;
  /** plan 落盘路径(`<workspace>/.zhuye/plan/<plan_id>.md`);写盘失败缺省。 */
  path?: string | null;
  /** ready = 待决策/未观测到决策;approved / rejected = 已决策。 */
  status: 'ready' | 'approved' | 'rejected';
}

/** plan 草稿(plan 模式下 agent 写入 `.zhuye/plan/` 的实时快照)。 */
export interface PlanDraftState {
  markdown: string;
  path?: string | null;
}

/**
 * agent 的 todo 清单条目。
 *
 * 来源:`TodoWrite` 工具的 `output.metadata.todos`(核心把清单放进工具
 * 输出元数据,事件流里就有)。核心目前**没有消费方**(reducer 缺失,LLM
 * 看不到清单)—— 但清单本身在事件里,GUI 可以如实展示。
 */
export interface TodoItem {
  /** todo 正文(一句话)。 */
  content: string;
  /** `pending` / `in_progress` / `completed`。 */
  status: string;
  /** 进行时态描述(可选,用于 spinner 文案)。 */
  active_form?: string | null;
}

export interface McpInvocation {  server: string;
  tool: string;
  callId: string;
  at: number;
}

/**
 * plan 的单个执行步骤状态。
 *
 * 来源:核心 `EventMsg::PlanStep`(`plan_step` 事件)—— agent 执行已批准
 * 的 plan 时逐 step 上报状态。核心注释指明 TUI reducer 的语义是
 * 「按 `index` 就地更新或追加」,本实现与之同构。
 */
export interface PlanStepState {
  /** step 在 plan 中的序号(0 起)。 */
  index: number;
  /** 已知 step 总数(0 = 未知 / 动态)。 */
  total: number;
  /** `pending` / `in_progress` / `done` / `skipped`。 */
  status: string;
  /** step 简短描述(可选)。 */
  title?: string | null;
  /** 所属 plan id —— 换 plan 时清空上一份进度。 */
  planId: string;
}

/**
 * 观察到的插件加载事件，包含加载时贡献的 skill / 命令数量。
 */
export interface PluginLoadedInfo {
  /** 插件 id。 */
  plugin: string;
  /** 作用域(`user` / `project` / `local` / `managed`)。 */
  scope: string;
  /** 版本号。 */
  version: string;
  /** 贡献的 skill 数。 */
  skillCount: number;
  /** 贡献的 slash 命令数。 */
  commandCount: number;
  /** 上报时间(ms)。 */
  at: number;
}

/**
 * 协作域类型(CollabSession / CollabMessage / RoutingSnapshot)拆到
 * `./collabTypes`(单文件行数预算)—— 这里 re-export,既有导入路径保持有效。
 */
export type { CollabSession, CollabMessage, RoutingSnapshot } from './collabTypes';
import type { CollabSession, RoutingSnapshot } from './collabTypes';

export type ToastKind = 'info' | 'warn' | 'error' | 'success';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  ttlMs: number;
  createdAt: number;
}

export interface McpServerEntry {
  name: string;
  status: 'started' | 'failed';
  detail?: string;
}

export interface LspServerEntry {
  name: string;
  status: 'started' | 'failed';
  detail?: string;
}

export interface AgentSession {
  model: string;
  provider: string;
}

/** 一次 coding plan 自动切换（`stores/agent/planFailover.ts`）。 */
export interface PlanFailoverRecord {
  from: string;
  to: string;
  at: number;
}

/**
 * 子代理进度流单条(v1.4 C1 通道一)—— `subagent_progress` 事件的
 * GUI 投影,Inspector 子代理区块的滚动 feed。
 */
export interface SubagentProgressEntry {
  /** 来源事件 id(每条 progress 事件唯一)。 */
  id: string;
  childId: string;
  role: string;
  kind: 'message' | 'tool_begin' | 'tool_end';
  text: string;
  at: number;
}

/**
 * 子代理可观测状态(v1.4 C1)—— 会话作用域,hydrate/clear/reset 复位。
 * `lastStatus` 为最近一次 `Op::QuerySubagents` 的 `subagent_status`
 * 应答快照;尚未查询过时为 null。
 */
export interface SubagentsState {
  /** 进度推送 feed(追加式,封顶防长会话无界增长)。 */
  feed: SubagentProgressEntry[];
  lastStatus: SubagentStatusSnapshot[] | null;
}

/** feed 封顶条数:超出丢弃最旧(诊断流,不要求完整审计)。 */
export const SUBAGENT_FEED_CAP = 200;

/**
 * 提示词层状态(v1.6.1)—— `prompt_list` / `prompt_switched` 事件的投影。
 *
 * **进程级而非会话级**:提示词库由 `Op::PromptCommand` 作用在引擎的
 * 进程级库上(按模型自动匹配),切会话不重置 —— 因此 hydrate/clear
 * 不清理此字段。
 */
// F01:prompt_guard 统计类型拆到 `./guardStats`(单文件行数预算)。
import type { GuardStatsState } from './guardStats';
export type { GuardStatsState };

export interface PromptState {
  selection?: import('@/utils/commands/prompts').PromptSelection;
  profile?: string;
  fallbackReason?: string;
  /** 可绑定的层文件名(不含 `.md`;内置厂商层 + 工具变体 + 用户目录层,去重)。 */
  available: string[];
  /** 当前 model spec(如 `"anthropic/claude-sonnet-5-5"`)。 */
  currentSpec: string;
  /** 当前 spec 实际命中的用户层文件名(诊断用,内嵌层不记录)。 */
  activeLayers: string[];
  /** v1.7:两级菜单工具分组(工具 → 模型变体);旧引擎不发,缺省 undefined。 */
  groups?: import('@/utils/commands/prompts').PromptGroup[];
  /** 最近一次提示词库重扫时间(ms);null = 尚未重扫过。 */
  switchedAt: number | null;
}

export interface AgentState {
  turns: Turn[];
  session: AgentSession | null;
  permissionMode: string;
  pendingApprovals: PendingApproval[];
  pendingQuestions: PendingQuestion[];
  pendingAskUser: PendingAskUser[];
  pendingPlan: PendingPlan | null;
  /** plan 终稿 / 草稿 —— Inspector 计划 tab 正文(草稿不持久化,重载即丢)。 */
  plan: PlanDocState | null;
  planDraft: PlanDraftState | null;
  mcpServers: McpServerEntry[];
  lspServers: LspServerEntry[];
  lastError: string | null;
  subscribed: boolean;
  loadedSessionId?: string | null;
  hydrateSession?: (id: string, records: ZhuyeRolloutRecord[]) => void;
  clearSession?: () => void;
  tokens: TokenSnapshot | null;
  /** 当前会话的 context window 大小(来自 session_configured),未知时为 null。 */
  contextWindowSize: number | null;
  /** 前端侧跟进消息队列(C)。仅在 turn 运行时入队;切会话即清空。 */
  queuedMessages: QueuedMessage[];
  /**
   * v1.12:上下文组成快照(六类估算分解)。来源:`context_composition`
   * 事件(引擎 model_call 组装后计量,指纹去重);工作台容量卡分解条形
   * 据此渲染。null = 尚未收到。
   */
  contextComposition: CompositionCategory[] | null;
  /**
   * v1.12:把引擎侧挂起交互快照(bind 返回的 pending_gates)水合进
   * pending 四字段 —— reload / 换绑后审批弹窗不再依赖前端内存投影。
   * 按 request_id 去重,已存在的挂起态不重复添加。
   */
  hydratePendingGates?: (gates: PendingGateSnapshot[]) => void;
  collabSessions: CollabSession[];
  mcpInvocations: McpInvocation[];
  /** MCP elicitation 挂起请求(`mcp_elicitation` 入列,回执移除)。 */
  pendingElicitations: PendingElicitation[];
  lastRouting: RoutingSnapshot | null;
  configReloadedAt: number | null;
  /** coding plan 自动切换记录（额度耗尽 → 默认供应商切换），状态栏展示用。 */
  planFailover: PlanFailoverRecord | null;
  /** 上下文压缩聚合统计（context_compacted 事件 + 回放 compaction record）。 */
  compactions: CompactionStats;
  toasts: Toast[];
  goalActive: boolean;
  /** v1.7 后端快照(`zhuye_goal_snapshot`):goalActive 投影的校准源,未挂载为 null。 */
  goalSnapshot: GoalSnapshotPayload | null;
  /** 子代理可观测(v1.4 C1)—— 会话作用域,见 SubagentsState。 */
  subagents: SubagentsState;
  /**
   * agent 的 todo 清单(来自 `TodoWrite` 工具的输出元数据)。
   *
   * 会话作用域:agent 每次 `TodoWrite` **整体覆盖**上一轮清单。
   * 空数组 = 当前没有清单。
   */
  todos: TodoItem[];
  /**
   * plan 执行进度(来自 `plan_step` 事件)—— 会话作用域。
   *
   * 核心在 agent 执行已批准的 plan 时逐 step 上报;此前 GUI 只在
   * 审批前展示 plan 正文,**执行到哪一步完全不可见**。
   */
  planSteps: PlanStepState[];
  /**
   * 本进程观察到的插件加载事件；这不是当前运行时快照。
   * 插件面板通过插件列表命令查询当前加载状态。
   */
  loadedPlugins: PluginLoadedInfo[];
  /**
   * 提示词层状态(v1.6.1)—— 进程级,见 PromptState。尚未收到
   * `prompt_list` 事件时为 null。
   */
  prompt: PromptState | null;
  /**
   * F01:prompt_guard 裁决统计(进程级,见 GuardStatsState)。
   * 尚未查询过(`Op::QueryGuardStats` 未发出)时为 null。
   */
  guardStats: GuardStatsState | null;
  /**
   * 提示词层面板是否展开(v1.6.1)—— `/prompt` slash 打开,
   * 展示可用层与当前生效层。
   */
  promptPanelOpen: boolean;
  /** 展开提示词层面板。 */
  openPromptPanel: () => void;
  /** 收起提示词层面板。 */
  closePromptPanel: () => void;
  setGoalActive: (active: boolean) => void;
  syncGoalSnapshot: () => Promise<void>;

  subscribe: () => () => void;
  /**
   * v1.x：第二个可选参数 `workspace` —— 当前激活工作区(绝对路径)。
   * 注入到 `ZhuyeSubmission.workspace`，后端据此把该 session 归属到
   * 指定 workspace 并在 `session_meta.workspace` 字段落盘。
   * `undefined` / `null` 表示不指定(CLI / 测试场景)。
   */
  submit: (text: string, workspace?: string | null) => Promise<void>;
  submitItems: (items: UserInputItem[], workspace?: string | null) => Promise<void>;
  /**
   * v1.4 A2:回合中途转向 —— 不打断当前 turn,消息经 `Op::Steer` 进
   * 会话转向队列,下一个安全点注入(引擎不发协议事件,这里乐观渲染)。
   * 无在飞 turn 时(竞态)退化为前端排队。`priority: 'now'` = 用户中途
   * 说话;`'attachment'` = 参考资料(缺省)。
   */
  steer: (items: UserInputItem[], priority?: 'now' | 'attachment') => Promise<void>;
  /**
   * v1.4 C1:查询子代理状态。应答 `subagent_status` 事件异步到达,
   * reducer 写入 `subagents.lastStatus`。
   */
  querySubagents: (childId?: string) => Promise<void>;
  /** 取消一个运行中的子代理；主会话 turn 不受影响。 */
  interruptSubagent: (childId: string) => Promise<void>;
  /**
   * v1.6.1:查询提示词层。应答 `prompt_list` 事件异步到达,reducer
   * 写入 `prompt`(进程级,不随会话切换重置)。
   */
  promptList: () => Promise<void>;
  /**
   * v1.6.1:重扫提示词库(`.zhuye/prompts/*.md` 改动即时生效)。
   * 应答 `prompt_switched` 事件异步到达,reducer 写入 `prompt` 并弹 toast。
   */
  promptRescan: (layer?: string | null) => Promise<void>;
  /**
   * F01:查询 prompt_guard 裁决统计。应答 `guard_stats` 事件异步到达,
   * reducer 写入 `guardStats`。
   */
  queryGuardStats: () => Promise<void>;
  /** C：把一条跟进消息加入前端队列（turn 运行中不直发后端）。 */
  enqueueMessage: (items: UserInputItem[], workspace?: string | null) => void;
  /** C：移除队列中的一条待发送消息。 */
  removeQueued: (id: string) => void;
  /** C：编辑队列消息的纯文本内容（仅首个 text item）。 */
  updateQueued: (id: string, text: string) => void;
  /**
   * v1.13：把一条排队消息拖到新位置（拖拽排序）。
   *
   * `toIndex` 是**当前会话队列内**的目标下标（0 起），越界自动钳制。
   * 队列按会话混存在一个数组里，重排只在前台会话的子序列内进行，
   * 其他会话的条目槽位保持不变。
   */
  reorderQueued: (fromId: string, toIndex: number) => void;
  /**
   * C：排空队列 —— 无运行中 turn 且无待处理交互（审批/提问/输入/plan）
   * 时，取出队首消息直接提交。turn_complete / turn_aborted 后自动调用。
   */
  drainQueue: () => Promise<void>;
  interrupt: () => Promise<void>;
  compact: () => Promise<void>;
  rewind: (toTurnId?: string) => Promise<void>;
  shutdown: () => Promise<void>;
  approve: (
    kind: 'tool' | 'hook',
    id: string,
    decision: ReviewDecision,
  ) => Promise<void>;
  /** Plan 审批 —— 三选一 PlanApprovalChoice(语义与 tool/hook 的 ReviewDecision 不同)。 */
  approvePlan: (id: string, choice: PlanApprovalChoice) => Promise<void>;
  enterPlanMode: (task: string) => Promise<void>;
  exitPlanMode: () => Promise<void>;
  setEffort: (level: 'low' | 'medium' | 'high' | 'max' | 'ultra') => Promise<void>;
  setPermissionMode: (mode: string) => Promise<void>;
  cyclePermissionMode: () => Promise<void>;
  /**
   * 仅同步本地权限模式状态(不发 Op)。会话切换后由 bind 返回值调用,
   * 让徽标/切换器反映该会话恢复出的模式。
   */
  syncPermissionMode: (mode: string) => void;
  /**
   * worktree 隔离意图（草稿级，不持久化）。非 null = 「下一个新会话在
   * 隔离 worktree 中运行」，`ref` 为起点分支（null = 当前 HEAD）。
   * 发送链路一次性消费（见 useComposerSubmission），换会话/新建草稿
   * 即重置 —— 顶栏开关只是意图登记，不直接建树。
   */
  worktreeIntent: { ref: string | null } | null;
  /** 写入/清空 worktree 隔离意图（顶栏开关与起点分支选择器共用）。 */
  setWorktreeIntent: (intent: { ref: string | null } | null) => void;
  answerQuestion: (id: string, answers: AskUserAnswer) => Promise<void>;
  answerInput: (id: string, text: string) => Promise<void>;
  /** 回执 MCP elicitation 请求(accept/decline/cancel;form 形态附 content)。 */
  resolveElicitation: (
    id: string,
    action: 'accept' | 'decline' | 'cancel',
    content?: Record<string, unknown>,
  ) => Promise<void>;
  clearError: () => void;
  pushToast: (toast: { kind: ToastKind; message: string; ttlMs?: number }) => string;
  dismissToast: (id: string) => void;
  reset: () => void;
}
