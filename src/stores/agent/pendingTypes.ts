/**
 * 挂起人机交互的前端投影类型(审批 / 提问 / 自由文本询问 / plan)。
 *
 * 构造来源只有一份:`reducer.reduceEvent` 的四个 pending 分支(合成事件
 * 亦经同一路径 —— `pendingGates.ts` 的 reload 水合、live 事件流)。
 * 跨会话存活的机制见 `../backgroundSessions.ts`(切走播种 / 切回注回)。
 */
import type { RiskLevel } from '@/types/protocol/enums';
import type { McpElicitationField } from '@/types/protocol';

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

/**
 * MCP server 的挂起 elicitation 请求(`mcp_elicitation` 事件)。
 *
 * 引擎侧「要人答」的阻塞请求:回执走 `zhuye_mcp_elicitation_response`
 * (`stores/agent/store.ts` 的 `resolveElicitation`)。GUI 弹窗尚未落地,
 * 挂起态先入列(封顶 20 条)供后续切片与诊断消费;未决请求由引擎 TTL
 * 以 `cancel` 了结(fail-closed),会话切换时随本地状态整体重置。
 */
export interface PendingElicitation {
  /** 请求 id,回执原样回传(= `request_id`)。 */
  id: string;
  /** 发起请求的 server 名。 */
  server: string;
  /** 向用户展示的提示。 */
  message: string;
  /** 交互形式(form 字段收集 / link 引导)。 */
  kind: { type: 'form'; fields: McpElicitationField[] } | { type: 'link'; url: string };
  /** 本地入列时间戳。 */
  at: number;
}
