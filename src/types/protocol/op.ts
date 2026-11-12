/**
 * Reflect protocol —— Submission Op 判别联合。
 *
 * 对应 `zhuye-agent/crates/protocol/reflect-protocol/src/op.rs` 中的 `Op`。每个变体使用
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
  | 'set_permission_mode'
  | 'cycle_permission_mode'
  | 'enter_goal_mode'
  | 'exit_goal_mode'
  | 'prompt_command'
  | 'rescan_extensions'
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

export type ReflectSubmissionOp =
  | { type: 'user_input'; items: UserInputItem[]; thread_settings?: ThreadSettingsOverrides }
  | { type: 'interrupt'; child_id?: string | null }
  | { type: 'shutdown' }
  | { type: 'compact' }
  | { type: 'rewind'; to_turn_id?: string | null }
  /**
   * v1.4 A2:回合中途转向 —— 对正在跑的回合投喂补充指示(`priority:
   * 'now'`)或参考资料(`'attachment'`,默认)。不打断当前 turn,消息在
   * 下一个安全点进入模型上下文。桥接:`reflect_steer`(GUI Steer 模式)。
   */
  | { type: 'steer'; priority?: 'attachment' | 'now'; items: UserInputItem[] }
  /**
   * v1.4 C1:查询子代理状态。应答为 `subagent_status` 事件。
   * `child_id` 缺省 = 列出全部。桥接:`reflect_query_subagents`。
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
  | { type: 'set_permission_mode'; mode: PermissionMode }
  | { type: 'cycle_permission_mode' }
  | { type: 'enter_goal_mode'; goal: string; verify_command?: string | null; token_budget?: number | null }
  | { type: 'exit_goal_mode' }
  | { type: 'prompt_command'; action: { type: 'list' } | { type: 'switch'; layer?: string | null } }
  | { type: 'rescan_extensions'; skills: boolean; commands: boolean }
  | { type: 'register_tools'; tools: { name: string; description: string; parameters: unknown }[] }
  | { type: 'tool_execution_response'; call_id: string; output: ToolOutput }
  | { type: 'start_side_channel'; agent: string; prompt: string }
  | { type: 'cancel_side_channel'; id: string }
  | { type: 'query_side_channels'; id?: string | null };
