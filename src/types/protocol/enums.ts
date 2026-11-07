/**
 * Reflect protocol —— 共享核心枚举（字符串联合），所有领域模块共用。
 * 本文件仅包含*类型级*枚举（无 payload 结构体、无判别联合），
 * 可安全地被任何模块导入而不产生循环引用。
 *
 * 完整 barrel 再导出与顶层同步警告见 `./index.ts`。
 */

export type PermissionMode =
  | 'auto'
  | 'prompt'
  | 'deny'
  | 'plan'
  | 'accept_edits'
  | 'bubble'
  | 'bypass';

export type ApprovalPolicy = 'auto' | 'prompt' | 'deny';
export type SandboxPolicy = 'workspace_only' | 'os_sandbox' | 'full_access';
export type RiskLevel = 'low' | 'medium' | 'high';
/** 上游 v1.x 起 max / ultra 为新增档位(按模型能力表发送前钳制)。 */
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'max' | 'ultra';

/** ReviewDecision 使用 snake_case 标记。Deny 携带 `{ reason: string }` payload。 */
export type ReviewDecision = 'approve' | { deny: { reason: string } } | 'approve_for_session';

/**
 * PlanApprovalChoice — plan 模式审批的三选一(对应后端
 * `reflect_protocol::PlanApprovalChoice`,`#[serde(rename_all = "snake_case")]`)。
 *
 * - `auto_mode`:切到 AcceptEdits(自动批准编辑/写入类,Bash 等仍走审批)。
 * - `manual_approve`:切到 Prompt(逐工具审批,旧行为)。
 * - `revise`:留在 plan 模式,用户输入反馈继续 plan(等价 reject + 回到 plan 编辑)。
 */
export type PlanApprovalChoice = 'auto_mode' | 'manual_approve' | 'revise';
