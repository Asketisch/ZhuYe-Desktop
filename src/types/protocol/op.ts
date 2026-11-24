/**
 * 上游协议 —— Submission Op 判别联合。
 *
 * 对应 `zhuye-agent/crates/protocol/zhuye-protocol/src/op.rs` 中的 `Op`。每个变体使用
 * `type` discriminator 标记,与 Rust 的
 * `#[serde(rename_all = "snake_case")]` 枚举对齐。下方的 `OpType` 字符串
 * 联合即为这些 discriminator 的原始列表。
 *
 * 顶层同步警告见 `./index.ts`。
 */

import type { AskUserAnswer } from './question';
import type { UserInputItem } from './item';
import type { ToolOutput } from './event';
import type {
  ApprovalPolicy,
  ReasoningEffort,
  ReviewDecision,
  PlanApprovalChoice,
  SandboxPolicy,
  PermissionMode,
} from './enums';

export type OpType =
  | 'user_input'
  | 'compact'
  | 'interrupt'
  | 'rewind'
  | 'shutdown'
  | 'steer'
  | 'query_subagents'
  | 'tool_approval'
  | 'hook_approval'
  | 'enter_plan_mode'
  | 'exit_plan_mode'
  | 'plan_approval'
  | 'set_effort'
  | 'ask_user_question_response'
  | 'ask_user_input_response'
  | 'mcp_elicitation_response'
  | 'set_permission_mode'
  | 'cycle_permission_mode'
  | 'enter_goal_mode'
  | 'exit_goal_mode'
  | 'prompt_command'
  | 'rescan_extensions'
  | 'query_guard_stats'
  | 'register_tools'
  | 'tool_execution_response'
  | 'start_side_channel'
  | 'cancel_side_channel'
  | 'query_side_channels';

export interface ThreadSettingsOverrides {
  model?: string;
  approval_policy?: ApprovalPolicy;
  sandbox_policy?: SandboxPolicy;
  max_tool_concurrency?: number;
}

export interface W3cTraceContext {
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  trace_flags?: string;
}

export type ZhuyeSubmissionOp =
  | { type: 'user_input'; items: UserInputItem[]; thread_settings?: ThreadSettingsOverrides }
  | { type: 'interrupt'; child_id?: string | null }
  | { type: 'shutdown' }
  | { type: 'compact'; instructions?: string | null }
  | { type: 'rewind'; to_turn_id?: string | null }
  /**
   * v1.4 A2:回合中途转向 —— 对正在跑的回合投喂补充指示(`priority:
   * 'now'`)或参考资料(`'attachment'`,默认)。不打断当前 turn,消息在
   * 下一个安全点进入模型上下文。桥接:`zhuye_steer`(GUI Steer 模式)。
   */
  | { type: 'steer'; priority?: 'attachment' | 'now'; items: UserInputItem[] }
  /**
   * v1.4 C1:查询子代理状态。应答为 `subagent_status` 事件。
   * `child_id` 缺省 = 列出全部。桥接:`zhuye_query_subagents`。
   */
  | { type: 'query_subagents'; child_id?: string }
  | { type: 'tool_approval'; id: string; decision: ReviewDecision }
  | { type: 'hook_approval'; id: string; decision: ReviewDecision }
  | { type: 'enter_plan_mode'; task: string }
  | { type: 'exit_plan_mode' }
  | { type: 'plan_approval'; id: string; choice: PlanApprovalChoice }
  | { type: 'set_effort'; effort: ReasoningEffort }
  | { type: 'ask_user_question_response'; id: string; answers: AskUserAnswer }
  | { type: 'ask_user_input_response'; id: string; text: string }
  /**
   * MCP server elicitation 回执:引擎按 `id`(= `mcp_elicitation` 事件的
   * `request_id`)解锁阻塞中的 rmcp 请求。`action` 为服务端协议值
   * `"accept"` / `"decline"` / `"cancel"`(直透);`content` 仅 accept 且
   * form 形态需要,形如 `{字段名: 值}`。桥接:`zhuye_mcp_elicitation_response`。
   */
  | { type: 'mcp_elicitation_response'; id: string; action: string; content?: Record<string, unknown> | null }
  | { type: 'set_permission_mode'; mode: PermissionMode }
  | { type: 'cycle_permission_mode' }
  | { type: 'enter_goal_mode'; goal: string; verify_command?: string | null; token_budget?: number | null }
  | { type: 'exit_goal_mode' }
  | { type: 'prompt_command'; action: { type: 'list' } | { type: 'switch'; layer?: string | null } }
  | { type: 'rescan_extensions'; skills: boolean; commands: boolean }
  /** F01:查询 prompt_guard 裁决统计(应答 `guard_stats` 事件;不开 turn)。 */
  | { type: 'query_guard_stats' }
  | { type: 'register_tools'; tools: { name: string; description: string; parameters: unknown }[] }
  | { type: 'tool_execution_response'; call_id: string; output: ToolOutput }
  | { type: 'start_side_channel'; agent: string; prompt: string }
  | { type: 'cancel_side_channel'; id: string }
  | { type: 'query_side_channels'; id?: string | null };
