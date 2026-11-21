/**
 * 挂起人机交互的前端投影类型(审批 / 提问 / 自由文本询问 / plan)。
 *
 * 构造来源只有一份:`reducer.reduceEvent` 的四个 pending 分支(合成事件
 * 亦经同一路径 —— `pendingGates.ts` 的 reload 水合、live 事件流)。
 * 跨会话存活的机制见 `../backgroundSessions.ts`(切走播种 / 切回注回)。
 */
import type { RiskLevel } from '@/types/protocol/enums';

export interface PendingApproval {
  id: string;
  /** tool / hook 审批;plan 审批走独立的 PendingPlan + PlanReadyModal(ApprovePlan)。 */
  kind: 'tool' | 'hook';
  toolName?: string;
  argsSummary?: string;
  /**
   * 工具调用的**原始参数**(仅 tool 审批)。
   *
   * 审批弹窗要据此推导「始终允许这条命令」的匹配模式(如 Bash 的
   * `args.cmd`),所以必须保留原值 —— `argsSummary` 是截断过的展示串。
   */
  args?: unknown;
  /** Permission bubble 审批的 risk level(非 bubble 流程省略)。 */
  risk?: RiskLevel;
  turnId: string;
}

export interface PendingQuestion {
  id: string;
  payload: unknown;
  turnId: string;
}

export interface PendingAskUser {
  id: string;
  payload: unknown;
  turnId: string;
}

export interface PendingPlan {
  id: string;
  kind?: 'request' | 'ready';
  payload: unknown;
  turnId: string;
}
