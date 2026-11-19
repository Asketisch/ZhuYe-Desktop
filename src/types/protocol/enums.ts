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

/** UI 三态轮换的规范档位（`ComposerControls` 分段 / `next_in_ui_cycle` 同口径）。 */
export type UiPermissionMode = 'auto' | 'prompt' | 'plan';

/**
 * 弃用档 → 三态归一化（v1.x）。
 *
 * 背景：引擎计划批准的 `auto_mode` 选择会把模式切到已弃用的
 * `accept_edits`（zhuye-agent submission_loop.rs `apply_plan_approval_choice`），
 * `permission_mode_changed` 事件随之把弃用档写进 store —— UI 若如实回显
 * 会出现第四态。归一化规则（与引擎语义一一对应）：
 *
 * - `accept_edits → auto`：引擎 `auto_approves_tool` 中 `Auto | AcceptEdits`
 *   行为完全一致（item.rs 注释「该语义已并入默认档 Auto」），映射无损；
 * - `bypass → prompt`：引擎 SetPermissionMode 入口对 Bypass 的降级目标
 *   （安全基线），桌面 bind 恢复路径（sessions.rs）同款；
 * - `deny / bubble → auto`：与 StatusBar `nextWorkMode` 的回落口径一致。
 */
export function normalizePermissionMode(mode: PermissionMode): UiPermissionMode {
  if (mode === 'prompt' || mode === 'plan') return mode;
  if (mode === 'bypass') return 'prompt';
  return 'auto';
}

export type ApprovalPolicy = 'auto' | 'prompt' | 'deny' | 'auto_approve' | 'full_access';
export type SandboxPolicy = 'workspace_only' | 'os_sandbox' | 'full_access';
export type RiskLevel = 'low' | 'medium' | 'high';
/** 上游 v1.x 起 max / ultra 为新增档位(按模型能力表发送前钳制)。 */
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'max' | 'ultra';

/** ReviewDecision 使用 snake_case 标记。Deny 携带 `{ reason: string }` payload。 */
export type ReviewDecision =
  | 'approve'
  | { deny: { reason: string } }
  | 'approve_for_session'
  /** F06:拒绝且本会话不再问([N]ever 键;引擎侧记入会话级拒绝表)。 */
  | { reject_for_session: { reason: string } };

/**
 * PlanApprovalChoice — plan 模式审批的三选一(对应后端
 * `reflect_protocol::PlanApprovalChoice`,`#[serde(rename_all = "snake_case")]`)。
 *
 * - `auto_mode`:切到 AcceptEdits(自动批准编辑/写入类,Bash 等仍走审批;
 *   引擎当前产物,桌面经 `normalizePermissionMode` 归一为 auto 展示)。
 * - `manual_approve`:切到 Prompt(逐工具审批,旧行为)。
 * - `revise`:留在 plan 模式,用户输入反馈继续 plan(等价 reject + 回到 plan 编辑)。
 */
export type PlanApprovalChoice = 'auto_mode' | 'manual_approve' | 'revise';
