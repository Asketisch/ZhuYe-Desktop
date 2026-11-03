/**
 * 共享 Tauri 类型 —— reflect-protocol 镜像 + ReflectAgent 特定类型。
 *
 * 权威来源：
 * - Rust: `zhuye-agent/crates/protocol/reflect-protocol/src/{event,event_msg,op,item,submission}.rs`
 * - TS:   `src/types/protocol.ts`（事件/Submission 判别联合）
 */

export interface ReflectSessionInfo {
  /**
   * 镜像 `reflect_protocol::SessionInfo`，与 `reflect_list_sessions`
   * 返回的结构一致（`zhuye-agent/crates/protocol/reflect-protocol/src/recorder.rs::SessionInfo`）。
   * 基础 4 字段 + 会话标题/累计用量 —— 更丰富的信息（provider、cwd 等）
   * 必须通过单独的命令暴露，而不是在这里追加。
   */
  session_id: string;
  model: string;
  /** RFC3339 timestamp (`DateTime<Utc>`). */
  started_at: string;
  message_count: number;
  /**
   * 会话标题：用户自定义名（`_names/<id>.name`）或首条 user 消息派生值。
   * Rust 端 `Option<String>` + `skip_serializing_if` —— 空会话/旧文件时
   * 字段缺省（`undefined`）。
   */
  title?: string;
  /** 整 session 累计 input tokens（旧文件为 0）。 */
  input_tokens?: number;
  /** 整 session 累计 output tokens（旧文件为 0）。 */
  output_tokens?: number;
  /** 整 session 累计 total tokens（旧文件为 0）。 */
  total_tokens?: number;
  /** 整 session 累计 USD cost（model 不在 pricing 表时缺省）。 */
  cost_usd?: number | null;
  /**
   * v1.x：会话归属工作区（绝对路径）。
   *
   * - 镜像 `reflect_protocol::SessionInfo.workspace`，由后端
   *   `session_meta.workspace` 派生 —— 创建该 session 的首条 Submission
   *   携带的 workspace 字段。
   * - 旧 session（升级前已落盘）字段缺省为 `undefined`；前端按
   *   "未归属"展示，且不进入任何工作区视图。
   * - `"null"` 序列化值由 Rust `#[serde(skip_serializing_if = "Option::is_none")]`
   *   保证不会出现；TS 这里用 `string | null` 仅作类型防御。
   */
  workspace?: string | null;
}

export interface ReflectRolloutRecord {
  type: string;
  [k: string]: unknown;
}

/**
 * ReviewDecision —— 对齐 Rust `reflect_protocol::ReviewDecision`。
 *
 * Rust 用 `#[serde(rename_all = "snake_case")]`,且 `Deny` 是 struct variant
 * (带 reason)。前端必须传以下形态之一,否则后端反序列化失败:
 *   - "approve"
 *   - "approve_for_session"
 *   - { deny: { reason: "..." } }
 */
export type ReviewDecision =
  | 'approve'
  | 'approve_for_session'
  | { deny: { reason: string } };

/**
 * PlanApprovalChoice —— 对齐 Rust `reflect_protocol::PlanApprovalChoice`。
 *
 * Rust 用 `#[serde(rename_all = "snake_case")]`,plan 审批三选一:
 *   - "auto_mode":切到 AcceptEdits(自动批准编辑/写入类)。
 *   - "manual_approve":切到 Prompt(逐工具审批,旧行为)。
 *   - "revise":留在 plan 模式,用户输入反馈继续 plan(等价 reject + 回到 plan 编辑)。
 */
export type PlanApprovalChoice = 'auto_mode' | 'manual_approve' | 'revise';