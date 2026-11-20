/**
 * 审批/分发命令封装 —— 与来自 `onZhuyeEvent` 的 `ReviewRequest` 事件流配对。
 *
 * Tool/hook approval 接收 `ReviewDecision`(approve / deny);
 * plan approval 接收 `PlanApprovalChoice`(auto_mode / manual_approve / revise)——
 * 对齐后端 `zhuye_protocol::PlanApprovalChoice`。
 */
import { invoke } from '../bridge';
import type { PlanApprovalChoice, ReviewDecision } from '../types';

/** 工具调用审批。 */
export async function zhuye_tool_approval(id: string, decision: ReviewDecision): Promise<string> {
  return invoke<string>('zhuye_tool_approval', { id, decision });
}

/** Hook approval. */
export async function zhuye_hook_approval(id: string, decision: ReviewDecision): Promise<string> {
  return invoke<string>('zhuye_hook_approval', { id, decision });
}

/** Plan approval —— 传入 `PlanApprovalChoice`(三选一)。 */
export async function zhuye_plan_approval(id: string, choice: PlanApprovalChoice): Promise<string> {
  return invoke<string>('zhuye_plan_approval', { id, choice });
}
