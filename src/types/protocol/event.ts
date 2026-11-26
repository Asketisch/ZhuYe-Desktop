/**
 * 上游协议 —— Tauri `zhuye_event` 信封。
 *
 * 对应 `zhuye-agent/crates/protocol/zhuye-protocol/src/event.rs` 和 `event_msg.rs`。
 * 外层信封形状为 `{ id: string; msg: ZhuyeEventMsg }`。`EventMsgByType` 映射
 * 是 Rust `EventMsg` 枚举的类型层镜像,允许 TS 通过 `event.msg.type` 收窄类型。
 *
 * 从 barrel 再导出的辅助/常量:
 *   - `EVENT_ID_NONE` → `''`(空字符串,session 级事件的 id)
 *   - `EventMsgType` → 所有 discriminator 值的字符串字面量联合
 *   - `ZhuyeEventMsg` → 跨 `EventMsgType` 的判别联合
 *   - `ZhuyeEvent` → 外层信封
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
 * 外层信封:Tauri `zhuye_event` 事件的 payload 形如
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
  // LLM 输出 (5)
  | 'agent_message'
  | 'agent_message_delta'
  | 'agent_message_reset'
  | 'thinking_delta'
  | 'token_count'
  // v1.12:上下文组成快照(六类估算分解;组成无变化时省略不发)
  | 'context_composition'
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
  // v1.12:挂起交互(审批/问答/询问/plan)已按任意路径了结的广播
  | 'interaction_resolved'
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
  // MCP (4)
  | 'mcp_server_started'
  | 'mcp_server_failed'
  | 'mcp_tool_invoked'
  | 'mcp_elicitation'
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
  | 'extensions_rescanned'
  // 注入防护统计 (1;F01)
  | 'guard_stats'
  // Prompt cache 保温 (1;v1.x,develop)—— 引擎主动推的诊断事件,无对应 Op
  | 'cache_warming'
  // 流锚点恢复 (4;v1.x,develop)—— 恢复过程事件化,不改变 stream_error /
  // agent_message_reset 的既有语义与顺序
  | 'stream_recovery_started'
  | 'stream_recovery_anchor_selected'
  | 'stream_recovery_tail_discarded'
  | 'stream_recovery_retry_started';

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

/**
 * v1.10:本 turn 流式 assistant 输出被重置 —— 模型调用失败将自动重试,
 * 客户端应清空该 turn 正在流式生成的消息缓冲(文本 / thinking / 未完成
 * 的工具调用),等待重试的全新输出,防止两次输出拼接。
 */
export interface AgentMessageResetPayload {
  /** 触发重置的错误码(如 `"SSE_PARSE_ERROR"`)。 */
  reason_code: string;
  /** 重试退避等待(ms)。 */
  retry_in_ms: number;
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
  /**
   * v1.x:本条是否为**回合累计**。
   *
   * 引擎在回合收尾时会补发一条累计 `token_count`(数字 = 本回合逐次
   * 调用的累计,`provider` / `credential_label` / `model` 均为空)。
   * 缺省 `false` = 单次调用。**两者不可一并累计** —— 会话总量与费用
   * 会因此翻倍。
   */
  turn_total?: boolean;
}

/**
 * `prompt_list` —— v1.6.1:`Op::PromptCommand { action: List }` 的应答。
 * payload 镜像 Rust `PromptListEvent`(wire 为 snake_case)。
 */
export interface PromptListPayload {
  /** 可绑定的层文件名(不含 `.md`;内置厂商层 + 工具变体 + 用户目录层,去重)。 */
  available: string[];
  /** 当前 model spec(如 `"anthropic/claude-sonnet-5-5"`)。 */
  current_spec: string;
  /** 当前 spec 实际命中的用户层文件名(诊断用,内嵌层不记录)。 */
  active_layers: string[];
  selection?: import('@/utils/commands/knowledge/prompts').PromptSelection;
  profile?: string;
  fallback_reason?: string;
  /** v1.7:两级菜单工具分组(工具 → 模型变体);旧引擎不发,缺省 undefined。 */
  groups?: import('@/utils/commands/knowledge/prompts').PromptGroup[];
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
  selection?: import('@/utils/commands/knowledge/prompts').PromptSelection;
  profile?: string;
  fallback_reason?: string;
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

/**
 * `guard_stats` —— F01:`Op::QueryGuardStats` 的应答,prompt_guard
 * 裁决统计快照(会话累计)。payload 镜像 Rust `GuardStatsEvent`。
 */
export interface GuardStatsPayload {
  /** prompt_guard 是否启用(F01 起默认开启)。 */
  enabled: boolean;
  /** 工具定义扫描 Block、拒绝注册的累计次数。 */
  definitions_blocked: number;
  /** 工具定义扫描 Review、放行标注的累计次数。 */
  definitions_reviewed: number;
  /** 工具输出扫描 Block、内容被拦截替换的累计次数。 */
  outputs_blocked: number;
  /** 工具输出扫描 Review、metadata 标注的累计次数。 */
  outputs_reviewed: number;
}

/**
 * `cache_warming` —— v1.x(develop):prompt cache 保温状态,引擎主动推的
 * 诊断事件(无对应 Op,镜像 `context_composition` 形态)。空闲期 / 回合内
 * 以廉价重放刷新 provider prompt cache TTL,决策与执行状态经本事件对
 * 客户端可见,可与 `token_count` 的 `cached_tokens` 对照验证保温收益。
 * payload 镜像 Rust `CacheWarmingEvent`(develop)。
 */
export interface CacheWarmingPayload {
  /** 保温动作:`scheduled`(空闲排程建立,一次)/ `executed`(重放成功)/
   *  `skipped`(决策不保温,`reason` 给因)/ `cancelled`(在途重放被取消)。 */
  action: 'scheduled' | 'executed' | 'skipped' | 'cancelled';
  /** 保温阶段:`turn`(回合内工具执行期)/ `idle`(回合间空闲期)。 */
  phase: 'turn' | 'idle';
  /** `skipped` / `cancelled` 的原因(如 `no_economics` / `disabled` / `superseded`)。 */
  reason?: string;
  /** 候选请求的 prompt tokens(上次真实请求的 input_tokens)。 */
  prompt_tokens?: number;
  /** 本次重放流回的真实缓存命中 tokens(仅 executed;与 `cached_tokens` 同语义)。 */
  warm_cached_tokens?: number;
  /** 本次保温重放成本 USD(仅 executed)。 */
  warm_cost_usd?: number;
  /** 决策期期望节省估算 USD(executed / skipped 均可能携带)。 */
  expected_savings_usd?: number;
  /** 模型 spec(如 `"anthropic/claude-sonnet-5-5"`)。 */
  model?: string;
  /** 发生时间(Unix 秒数)。 */
  at: number;
}

/**
 * 流锚点恢复事件族载荷(v1.x,develop)—— 四个变体共享同一形状,按
 * `type` 区分。数值字段按 stage 可选,省略不出现在 wire 上
 * (与 `token_count` 同策略)。payload 镜像 Rust `StreamRecoveryEvent`。
 */
export interface StreamRecoveryPayload {
  /** 第几次恢复尝试(1 起)。 */
  attempt: number;
  /** 失败原因码(与 `stream_error.code` 同源)。 */
  reason_code: string;
  /** 瞬态分类(`provider_timeout` / `provider_network_error` / `provider_stream_error`)。 */
  transient?: string;
  /** 选定的恢复锚点(`previous_message` = 最后一条已提交消息)。 */
  anchor?: string;
  /** 丢弃尾部的文本字符数(仅 tail_discarded)。 */
  discarded_text_chars?: number;
  /** 丢弃尾部的思考字符数(仅 tail_discarded)。 */
  discarded_thinking_chars?: number;
  /** 建议重试等待毫秒(仅 retry_started)。 */
  retry_in_ms?: number;
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
  outcome: string; // "consensus" | "no_consensus" | "finished" | "failed" | "cancelled"
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

/** MCP elicitation 表单字段的输入类型(serde `type` tagged)。 */
export type McpElicitationFieldKind =
  | { type: 'text'; secret?: boolean }
  | { type: 'number'; integer?: boolean }
  | { type: 'boolean' }
  | { type: 'enum'; options: string[]; multi?: boolean };

/** MCP elicitation 表单字段定义(字段名不得改写,回执按它组 content)。 */
export interface McpElicitationField {
  name: string;
  title?: string;
  description?: string;
  required?: boolean;
  kind: McpElicitationFieldKind;
}

/** MCP server 向宿主用户请求输入(`elicitation/create`;要人答,阻塞)。 */
export interface McpElicitationPayload {
  /** 请求 id,回执 `Op::mcp_elicitation_response` 原样回传。 */
  request_id: string;
  /** 发起请求的 server 名(插件挂载为 `plugin:<id>:<名>`)。 */
  server: string;
  /** 向用户展示的提示。 */
  message: string;
  /** 交互形式:form(收集字段)/ link(引导用户打开 url)。 */
  kind:
    | { type: 'form'; fields: McpElicitationField[] }
    | { type: 'link'; url: string };
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
  plan_id: string;
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
 * 与 `zhuye_list_side_channels` 命令返回的 `ZhuyeSideChannelInfo`
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

/** v1.12:上下文组成类别 id(六类;`unknown` 为前向容错值)。 */
export type CompositionCategoryId =
  | 'system_prompt'
  | 'memory'
  | 'skills'
  | 'tool_schemas'
  | 'mcp_tools'
  | 'messages'
  | 'unknown';

/** v1.12:一个类别的估算 token 量(估算值,非精确计量)。 */
export interface CompositionCategory {
  id: CompositionCategoryId;
  tokens: number;
}

/** v1.12:`context_composition` —— 上下文组成快照(六类估算分解)。 */
export interface ContextCompositionPayload {
  categories: CompositionCategory[];
}

/** v1.12:挂起交互类别(snake_case tag 联合,同 Rust InteractionKind)。 */
export type InteractionKindPayload =
  | { type: 'tool'; tool_name: string }
  | { type: 'hook'; hook_name: string }
  | { type: 'question' }
  | { type: 'ask_user' }
  | { type: 'plan'; plan_id: string };

/** v1.12:挂起交互了结路径(引擎侧 fail-closed / 通道级了结含在内)。 */
export type InteractionOutcome = 'answered' | 'expired' | 'cancelled' | 'interrupted' | 'channel_closed';

/** v1.12:`interaction_resolved` —— 挂起交互已了结,客户端按 request_id 清理挂起态。 */
export interface InteractionResolvedPayload {
  request_id: string;
  kind: InteractionKindPayload;
  outcome: InteractionOutcome;
}

/**
 * v1.12:引擎侧挂起交互快照行(`zhuye_bind_session` 返回的
 * `pending_gates` 数组元素;对应 Rust `PendingInteraction`)。
 * `payload` 与对应 `EventMsg` 变体字段同构(不含 request_id),
 * reload / 换绑后据此完整重建审批 / 问答 UI。
 */
export interface PendingGateSnapshot {
  request_id: string;
  kind: InteractionKindPayload;
  summary: string;
  created_at_ms: number;
  expires_at_ms?: number | null;
  payload?: unknown;
}

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
  /** v1.10:模型调用失败将自动重试,清空本 turn 半成品输出缓冲。 */
  agent_message_reset: AgentMessageResetPayload;
  thinking_delta: ThinkingDeltaPayload;
  token_count: TokenCountPayload;
  // v1.12:上下文组成快照
  context_composition: ContextCompositionPayload;
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
  // v1.12:挂起交互了结通知
  interaction_resolved: InteractionResolvedPayload;
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
  mcp_elicitation: McpElicitationPayload;
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
  // 注入防护统计 (F01)
  guard_stats: GuardStatsPayload;
  // Prompt cache 保温(v1.x,develop)
  cache_warming: CacheWarmingPayload;
  // 流锚点恢复事件族(v1.x,develop)
  stream_recovery_started: StreamRecoveryPayload;
  stream_recovery_anchor_selected: StreamRecoveryPayload;
  stream_recovery_tail_discarded: StreamRecoveryPayload;
  stream_recovery_retry_started: StreamRecoveryPayload;
}

/** ZhuyeEvent 的单一联合变体 —— 通过 `msg.type` 收窄。 */
export type ZhuyeEventMsg = {
  [T in EventMsgType]: { type: T } & EventMsgByType[T];
}[EventMsgType];

/** 外层 Tauri `zhuye_event` payload。 */
export interface ZhuyeEvent {
  id: string;
  msg: ZhuyeEventMsg;
  /**
   * v1.12:会话扇出序号(引擎 `Event.seq`)。会话扇出流上从 1 起单调
   * 递增;`0` = per-turn 专属流(如逐 token delta 的 SDK 快路),不参与
   * 缺口判定。前端据此检测缺口(>last+1 → 触发重放重同步)。
   */
  seq: number;
}

/** 外层 Tauri `zhuye_session_event` payload(v1.x 后台持续运行)。 */
export interface ZhuyeSessionEvent {
  session_id: string;
  event: ZhuyeEvent;
}
