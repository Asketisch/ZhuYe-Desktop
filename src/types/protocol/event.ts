/**
 * Reflect protocol —— Tauri `reflect_event` 信封。
 *
 * 对应 `zhuye-agent/crates/protocol/reflect-protocol/src/event.rs` 和 `event_msg.rs`。
 * 外层信封形状为 `{ id: string; msg: ReflectEventMsg }`。`EventMsgByType` 映射
 * 是 Rust `EventMsg` 枚举的类型层镜像,允许 TS 通过 `event.msg.type` 收窄类型。
 *
 * 从 barrel 再导出的辅助/常量:
 *   - `EVENT_ID_NONE` → `''`(空字符串,session 级事件的 id)
 *   - `EventMsgType` → 所有 discriminator 值的字符串字面量联合
 *   - `ReflectEventMsg` → 跨 `EventMsgType` 的判别联合
 *   - `ReflectEvent` → 外层信封
 *
 * 顶层同步警告见 `./index.ts`。
 */

import type { ApprovalPolicy, RiskLevel, SandboxPolicy, PermissionMode } from './enums';
import type { AskUserInputPayload } from './ask_user_input';
import type { Question } from './question';
import type { TokenUsagePayload } from './usage';

/** Submission id `"EVENT_ID_NONE"` = session 级事件,没有对应的 submission。 */
export const EVENT_ID_NONE = '';

/**
 * 外层信封:Tauri `reflect_event` 事件的 payload 形如
 * `{ id: string; msg: EventMsgByType[T] }`。`Event` 接口基于 `msg.type` 使用
 * TypeScript 的判别联合,使消费者可以用 `switch (event.msg.type)` 收窄 payload 形状。
 */
export type EventMsgType =
  // 生命周期 (7)
  | 'session_configured'
  | 'turn_started'
  | 'turn_complete'
  | 'turn_aborted'
  | 'turn_rewound'
  | 'submission_closed'
  | 'shutdown_complete'
  // LLM 输出 (4)
  | 'agent_message'
  | 'agent_message_delta'
  | 'thinking_delta'
  | 'token_count'
  // 工具 (5)
  | 'tool_call_begin'
  | 'tool_call_args_delta'
  | 'tool_call_end'
  | 'tool_call_output_delta'
  | 'tool_execution_request'
  // 子代理可观测 (2;v1.4 C1)
  | 'subagent_progress'
  | 'subagent_status'
  // side-channel agent (3;v1.x WP9,develop 收编)
  | 'side_channel_started'
  | 'side_channel_finished'
  | 'side_channel_status'
  // 审批 (1)
  | 'approval_request'
  // 用户提问 (2)
  | 'ask_user_question'
  | 'ask_user_input'
  // 权限气泡 (1)
  | 'permission_bubble'
  // 上下文压缩 (1)
  | 'context_compacted'
  // 错误 (2)
  | 'error'
  | 'stream_error'
  // 配置 / 路由 (2)
  | 'config_reloaded'
  | 'routing'
  // 协作 (3)
  | 'collab_started'
  | 'collab_message'
  | 'collab_finished'
  // MCP (3)
  | 'mcp_server_started'
  | 'mcp_server_failed'
  | 'mcp_tool_invoked'
  // LSP (2)
  | 'lsp_server_started'
  | 'lsp_server_failed'
  // Plan 模式 (7)
  | 'plan_request'
  | 'plan_ready'
  | 'plan_approved'
  | 'plan_rejected'
  | 'plan_draft_updated'
  | 'plan_step'
  | 'permission_mode_changed'
  // 插件 / 配额
  | 'plugin_loaded'
  | 'quota_exhausted'
  // 提示词层 (2;v1.6.1)
  | 'prompt_list'
  | 'prompt_switched'
  // 扩展重扫 (1;v1.x,submodule main)
  | 'extensions_rescanned';

// ============================================================================
// EventMsg payload 结构体
// ============================================================================

export interface SessionConfiguredPayload {
  session_id: string; // ThreadId (uuid)
  model: string;
  provider: string;
  approval_policy: ApprovalPolicy;
  sandbox_policy: SandboxPolicy;
  context_window_size?: number;
}

export interface TurnStartedPayload {
  turn_id: string; // TurnId
  user_message_id?: string;
}

export interface TurnCompletePayload {
  turn_id: string;
  usage: TokenUsagePayload;
  status: 'success' | 'max_iterations' | 'stopped' | 'token_budget_exceeded';
}

export type AbortReasonPayload =
  | { type: 'user_interrupt' }
  | { type: 'shutdown' }
  | { type: 'error'; code: string; message: string };

export interface TurnAbortedPayload {
  turn_id: string;
  reason: AbortReasonPayload;
}

export interface TurnRewoundPayload {
  to_turn_id?: string;
  truncated_after: number;
}

export interface AgentMessagePayload {
  text: string;
}

export interface AgentMessageDeltaPayload {
  delta: string;
}

export interface ThinkingDeltaPayload {
  delta: string;
  /**
   * v1.x(submodule main)思考增量的语义类型:`"raw"` token 级流式(默认),
   * `"summary"` 推理摘要。上游 `#[serde(default)]` 保持旧事件线缆兼容,
   * 旧引擎可能缺省 → `undefined` 视同 `"raw"`。
   */
  kind?: 'raw' | 'summary' | 'unknown';
}

export interface TokenCountPayload extends TokenUsagePayload {
  // 与 TokenUsagePayload 结构一致
  /**
   * v1.x 模型级 token 统计:本轮实际命中的模型 spec(如 `"openai/gpt-4o"`)。
   * 旧引擎不上报该字段 → 缺省 `undefined`。
   */
  model?: string;
}

/**
 * `prompt_list` —— v1.6.1:`Op::PromptCommand { action: List }` 的应答。
 * payload 镜像 Rust `PromptListEvent`(wire 为 snake_case)。
 */
export interface PromptListPayload {
  /** 可绑定的层文件名(不含 `.md`;内置厂商层 + 用户目录层,去重)。 */
  available: string[];
  /** 当前 model spec(如 `"anthropic/claude-sonnet-5-5"`)。 */
  current_spec: string;
  /** 当前 spec 实际命中的用户层文件名(诊断用,内嵌层不记录)。 */
  active_layers: string[];
}

/**
 * `prompt_switched` —— v1.6.1:`Op::PromptCommand { action: Switch }` 的应答。
 * payload 镜像 Rust `PromptSwitchedEvent`(wire 为 snake_case)。
 */
export interface PromptSwitchedPayload {
  /** 触发重扫的动作名(`"reload"`;预留未来聚焦切换的层名)。 */
  action: string;
  /** 重扫后当前 spec 的生效用户层(让 UI 立即看到新命中)。 */
  active_layers: string[];
}

/**
 * `extensions_rescanned` —— v1.x(submodule main):`Op::RescanExtensions`
 * 的应答,运行时扩展目录重扫完成。payload 镜像 Rust
 * `ExtensionsRescannedEvent`(wire 为 snake_case)。
 */
export interface ExtensionsRescannedPayload {
  /** skills 目录重扫后的条目总数(文件型 + 插件型;未请求重扫时为 0)。 */
  skills: number;
  /** commands 重扫请求是否被处理。当前恒为 `false`(上游尚未接线)。 */
  commands: boolean;
}

export interface ToolCallBeginPayload {
  call_id: string;
  tool_name: string;
  args: unknown;
}

export interface ToolCallEndPayload {
  call_id: string;
  output: ToolOutput;
  is_error: boolean;
  elapsed_ms: number;
}

/**
 * `tool_call_output_delta` —— v1.4 A3:工具输出流式增量。长工具(构建 /
 * 测试)执行期间逐段上报 stdout/stderr,实时可见;最终完整输出仍以
 * `tool_call_end` 为准(增量只是预览,不做脱敏)。payload 镜像 Rust
 * `ToolCallOutputDeltaEvent`。
 */
export interface ToolCallOutputDeltaPayload {
  /** 与 `tool_call_begin.call_id` 配对的调用标识。 */
  call_id: string;
  /** 本段增量文本(按行或按块,由工具侧决定粒度)。 */
  delta: string;
  /** 本段是否来自标准错误流(后端 `#[serde(default)]`,可能缺省)。 */
  is_stderr?: boolean;
}

/**
 * `tool_call_args_delta` —— v1.5 additive 变体:流式工具参数增量。模型
 * 生成 tool_use 参数期间逐段转发 LLM 层的 `ToolUseDelta`(整包形态的
 * provider 不发——参数已随 `tool_call_begin` 前的 ToolUseStart 带全)。
 * 事件顺序:`tool_call_begin`(args 为 null) → 本事件 × N → `tool_call_end`;
 * 消费方按 `call_id` 累积,可在模型仍在生成时渐进渲染长参数工具
 * (write / edit 等)的输入。payload 镜像 Rust `ToolCallArgsDeltaEvent`。
 */
export interface ToolCallArgsDeltaPayload {
  /** 与 `tool_call_begin.call_id` 配对的调用标识。 */
  call_id: string;
  /** 本次增量追加的原始 JSON 参数片段(未解析,由消费方累积)。 */
  delta: string;
}

/**
 * `tool_execution_request` —— v1.3 SDK:core 请求客户端本地执行其经
 * `Op::RegisterTools` 注册的远程自定义工具,客户端以
 * `Op::ToolExecutionResponse { call_id, output }` 回执(同 call_id 配对)。
 * 仅 serve 模式会发出;Desktop 内嵌 AgentThread 不注册远程工具,
 * 类型保穷尽但不渲染。payload 镜像 Rust `ToolExecutionRequestEvent`。
 */
export interface ToolExecutionRequestPayload {
  /** 与 `Op::ToolExecutionResponse.call_id` 配对的请求标识(uuid)。 */
  call_id: string;
  /** 工具名(与 `RemoteToolSpec.name` 一致)。 */
  tool: string;
  /** LLM 发起的调用参数(已解析的 JSON 对象)。 */
  args: Record<string, unknown>;
}

export interface ToolOutput {
  content: ContentBlock[];
  is_error: boolean;
  metadata: unknown;
  elapsed_ms: number;
}

export interface ContentBlock {
  type: 'text' | 'image' | 'diff' | 'tool_use' | 'tool_result';
  // 文本
  text?: string;
  // 图像
  data?: string; // base64
  mime_type?: string;
  // 差异
  unified_diff?: string;
  // 工具调用
  id?: string;
  name?: string;
  args?: unknown;
  // 工具结果
  call_id?: string;
  output?: ToolOutput;
}

export interface ApprovalRequestPayload {
  request_id: string;
  kind: ApprovalKind;
  risk?: RiskLevel;
}

export type ApprovalKind =
  | { type: 'tool'; tool_name: string; args: unknown }
  | { type: 'hook'; hook_name: string; decision_preview: string }
  | { type: 'plan'; plan_id: string; summary: string };

export interface AskUserQuestionPayload {
  request_id: string;
  questions: Question[];
}

export interface PermissionBubblePayload {
  tool_name: string;
  args_preview?: string;
  risk?: RiskLevel;
}

export interface ContextCompactedPayload {
  // wire 值镜像 Rust `ContextCompactedStrategy`(rename_all = snake_case):
  // `LlMSummarize` → `ll_m_summarize`(缩写分段,不是 `llm_summarize`)。
  strategy: 'noop' | 'microcompact' | 'smart_prune' | 'll_m_summarize';
  removed_messages: number;
  before_tokens: number;
  after_tokens: number;
}

export interface ErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export interface StreamErrorPayload {
  code: string;
  message: string;
  retry_in_ms: number;
  provider?: string;
  credential_label?: string;
  tried?: { label: string; outcome: string }[];
}

export interface ConfigReloadedPayload {
  path: string;
  sections_changed: string[];
  at: number; // Unix 时间戳（秒）
}

export interface RoutingPayload {
  kind:
    | 'switched'
    | 'failed_over'
    | 'cooldown_started'
    | 'cooldown_cleared'
    // v1.7 R3:当前 spec 的 credential 池全部不可用,切到 fallback spec
    // (跨模型降级)。`from_credential` / `to_credential` 装的是
    // `"provider/model"` 形式的 spec,不再是凭据 label。
    | 'spec_fallback';
  role: string;
  from_credential?: string;
  to_credential?: string;
  reason: string;
  cooldown_until_ms?: number;
}

export interface CollabStartedPayload {
  id: string;
  participants: string[];
  mode: string;
}

export interface CollabMessagePayload {
  id: string;
  from: string;
  kind: string; // "utterance" | "consensus" | "finish"
  content: string;
  round: number;
  token_usage?: TokenUsagePayload;
}

export interface CollabFinishedPayload {
  id: string;
  outcome: string; // "consensus" | "no_consensus" | "finished"
  rounds: number;
}

export interface McpServerStartedPayload {
  server: string;
  tool_count: number;
  tool_names?: string[];
  transport: 'stdio' | 'http' | 'sse';
}

export interface McpServerFailedPayload {
  server: string;
  error: string;
  will_retry: boolean;
}

export interface McpToolInvokedPayload {
  server: string;
  tool: string;
  call_id: string;
}

export interface LspServerStartedPayload {
  server: string;
  methods: string[];
  language_ids: string[];
}

export interface LspServerFailedPayload {
  server: string;
  error: string;
  will_retry: boolean;
}

export interface PlanRequestPayload {
  task: string;
}

export interface PlanReadyPayload {
  plan_id: string;
  markdown: string;
  /**
   * plan markdown 落盘路径(`<workspace>/.zhuye/plan/<plan_id>.md`)。
   *
   * core 在 dispatch_plan_ready 时把 plan 写成文件,使其成为可引用、可
   * `cat` 的持久产物;写盘是 best-effort,失败时字段缺省。
   */
  path?: string;
}

export interface PlanApprovedPayload {
  plan_id: string;
}

export interface PlanRejectedPayload {
  plan_id: string;
  reason?: string;
}

/**
 * `plan_draft_updated` —— plan 草稿文件落盘后的覆盖式更新(可多次)。
 * GUI 的用户决策路径走 `plan_ready` 弹窗;此事件仅用于草稿预览刷新
 * (TUI 语义),payload 镜像 Rust `PlanDraftUpdatedEvent`。
 */
export interface PlanDraftUpdatedPayload {
  /** 草稿源文件名(不含目录,如 `refactor.md`)。 */
  draft_id: string;
  /** plan markdown 全文。 */
  markdown: string;
  /** 草稿落盘绝对路径;后端 `Option` + skip_serializing_if,可能缺省。 */
  path?: string;
}

export interface PermissionModeChangedPayload {
  from: PermissionMode;
  to: PermissionMode;
}

/** PlanStepStatus —— snake_case(对齐 Rust `PlanStepStatus`)。 */
export type PlanStepStatus = 'pending' | 'in_progress' | 'done' | 'skipped';

/** `plan_step` —— plan 执行进度(单 step 状态变更)。 */
export interface PlanStepPayload {
  plan_id: string;
  index: number;
  /** 已知 step 总数(0 = 未知 / 动态)。 */
  total: number;
  status: PlanStepStatus;
  title?: string;
}

/** `plugin_loaded` —— 插件运行时挂载完成。 */
export interface PluginLoadedPayload {
  plugin: string;
  scope?: string;
  version?: string;
  skill_count?: number;
  /** 该插件贡献的 slash 命令数(核心 v1.7 起上报)。 */
  command_count?: number;
}

/** `quota_exhausted` —— credential 配额耗尽,agent 因此停止。 */
export interface QuotaExhaustedPayload {
  provider: string;
  label: string;
  used_tokens?: number;
  max_tokens?: number;
  /** 窗口结束的 unix 秒数(窗口重置时间,后端 `QuotaExhaustedEvent::window_ends_secs`)。 */
  window_ends_secs?: number;
}

// ============================================================================
// 子代理可观测(v1.4 C1)
// ============================================================================

/** `subagent_progress.kind` —— 进度类别(snake_case,对齐 Rust `SubagentProgressKind`)。 */
export type SubagentProgressKind = 'message' | 'tool_begin' | 'tool_end';

/**
 * `subagent_progress` —— 通道一(推送):子代理中间进度。父级
 * `CallSubAgentTool` 把子事件流的 `agent_message` / `tool_call_begin` /
 * `tool_call_end` 包装转发;逐字增量不转发。payload 镜像 Rust
 * `SubagentProgressEvent`。
 */
export interface SubagentProgressPayload {
  /** 子代理会话号(`SpawnedChild.session_id` 字符串形态)。 */
  child_id: string;
  /** 子代理角色(spec.role,如 `"explorer"`)。 */
  role: string;
  kind: SubagentProgressKind;
  /** 文本载荷:message = 助手文本;tool_begin = 工具名;tool_end = 工具名(失败附 ` (failed)`)。 */
  text: string;
  /** 子代理内部工具调用的 call_id(tool_begin / tool_end 携带;message 省略)。 */
  call_id?: string;
}

/** `subagent_status.children[].state`(snake_case,对齐 Rust `SubagentRunStateMirror`)。 */
export type SubagentRunState = 'running' | 'completed' | 'failed' | 'cancelled';

/** 单个子代理的状态快照(镜像 Rust `SubagentStatusSnapshot`)。 */
export interface SubagentStatusSnapshot {
  child_id: string;
  role: string;
  state: SubagentRunState;
  /** 启动时间(RFC3339)。 */
  started_at: string;
  /** 终态时间;缺省 = 仍在运行。 */
  finished_at?: string;
  /** 已完成的图迭代次数(model_call 次数)。 */
  iteration: number;
  /** 正在执行的工具名;缺省 = 当前无工具在跑(或已终态)。 */
  current_tool?: string;
  /** 累计 token 用量(总)。 */
  total_tokens: number;
  /** 最近一条事件摘要(诊断用;截断到 ~200 字符)。 */
  last_event?: string;
}

/**
 * `subagent_status` —— 通道二(查询):`Op::QuerySubagents` 的应答快照。
 * `children` 为空表示没有匹配的在飞/近期子代理。payload 镜像 Rust
 * `SubagentStatusEvent`。
 */
export interface SubagentStatusPayload {
  children: SubagentStatusSnapshot[];
}

// ============================================================================
// side-channel agent (v1.x WP9)
// ============================================================================

/**
 * 单条 side-channel 公开视图(camelCase,镜像 Rust `SideChannelInfo`)。
 * 与 `reflect_list_side_channels` 命令返回的 `ReflectSideChannelInfo`
 * 同一 wire 形状。
 */
export interface SideChannelInfoPayload {
  id: string;
  agentName: string;
  prompt: string;
  startedAtMs: number;
  /** `"running" | "done" | "cancelled" | "error"`。 */
  status: 'running' | 'done' | 'cancelled' | 'error';
  /** 已运行时长(毫秒);仍在运行时为 `null`。 */
  durationMs: number | null;
}

/**
 * `side_channel_started` / `side_channel_finished` 共用载荷(镜像 Rust
 * `SideChannelEvent`,`tag = "kind"` snake_case 判别):
 * Started / Done / Cancelled / Error 四态。
 */
export type SideChannelEventPayload =
  | { kind: 'started'; id: string; agent_name: string; prompt: string; started_at_ms: number }
  | { kind: 'done'; id: string; finished_at_ms: number; summary?: string }
  | { kind: 'cancelled'; id: string; finished_at_ms: number }
  | { kind: 'error'; id: string; finished_at_ms: number; message: string };

/**
 * `side_channel_status` —— 通道二(查询):`Op::QuerySideChannels` 的
 * 应答快照(镜像 Rust `SideChannelStatusSnapshot`,camelCase)。
 */
export interface SideChannelStatusPayload {
  channels: SideChannelInfoPayload[];
}

// ============================================================================
// EventMsgByType —— 判别联合
// ============================================================================

/**
 * `EventMsgType` → payload 形状的映射。这是 Rust `EventMsg` 枚举的类型层镜像,
 * 让 TS 可以通过 `event.msg.type` 收窄。
 */
export interface EventMsgByType {
  // 生命周期
  session_configured: SessionConfiguredPayload;
  turn_started: TurnStartedPayload;
  turn_complete: TurnCompletePayload;
  turn_aborted: TurnAbortedPayload;
  turn_rewound: TurnRewoundPayload;
  /** v1.3 SDK:某条 submission 的 per-turn 通道已排空(serve drain task 发出)。Desktop 内嵌线程不产生本事件,reducer no-op 保穷尽。 */
  submission_closed: Record<string, never>;
  shutdown_complete: Record<string, never>;
  // LLM 输出
  agent_message: AgentMessagePayload;
  agent_message_delta: AgentMessageDeltaPayload;
  thinking_delta: ThinkingDeltaPayload;
  token_count: TokenCountPayload;
  // 工具
  tool_call_begin: ToolCallBeginPayload;
  tool_call_args_delta: ToolCallArgsDeltaPayload;
  tool_call_end: ToolCallEndPayload;
  tool_call_output_delta: ToolCallOutputDeltaPayload;
  tool_execution_request: ToolExecutionRequestPayload;
  // 子代理可观测(v1.4 C1)
  subagent_progress: SubagentProgressPayload;
  subagent_status: SubagentStatusPayload;
  // 审批
  approval_request: ApprovalRequestPayload;
  ask_user_question: AskUserQuestionPayload;
  ask_user_input: AskUserInputPayload;
  permission_bubble: PermissionBubblePayload;
  // 上下文压缩
  context_compacted: ContextCompactedPayload;
  // 错误
  error: ErrorPayload;
  stream_error: StreamErrorPayload;
  // 配置 / 路由
  config_reloaded: ConfigReloadedPayload;
  routing: RoutingPayload;
  // 协作
  collab_started: CollabStartedPayload;
  collab_message: CollabMessagePayload;
  collab_finished: CollabFinishedPayload;
  // MCP
  mcp_server_started: McpServerStartedPayload;
  mcp_server_failed: McpServerFailedPayload;
  mcp_tool_invoked: McpToolInvokedPayload;
  // LSP
  lsp_server_started: LspServerStartedPayload;
  lsp_server_failed: LspServerFailedPayload;
  // Plan
  plan_request: PlanRequestPayload;
  plan_ready: PlanReadyPayload;
  plan_approved: PlanApprovedPayload;
  plan_rejected: PlanRejectedPayload;
  plan_draft_updated: PlanDraftUpdatedPayload;
  plan_step: PlanStepPayload;
  permission_mode_changed: PermissionModeChangedPayload;
  // side-channel (v1.x WP9)
  side_channel_started: SideChannelEventPayload;
  side_channel_finished: SideChannelEventPayload;
  side_channel_status: SideChannelStatusPayload;
  // 插件 / 配额
  plugin_loaded: PluginLoadedPayload;
  quota_exhausted: QuotaExhaustedPayload;
  // 提示词层 (v1.6.1)
  prompt_list: PromptListPayload;
  prompt_switched: PromptSwitchedPayload;
  // 扩展重扫 (v1.x,submodule main)
  extensions_rescanned: ExtensionsRescannedPayload;
}

/** ReflectEvent 的单一联合变体 —— 通过 `msg.type` 收窄。 */
export type ReflectEventMsg = {
  [T in EventMsgType]: { type: T } & EventMsgByType[T];
}[EventMsgType];

/** 外层 Tauri `reflect_event` payload。 */
export interface ReflectEvent {
  id: string;
  msg: ReflectEventMsg;
}
