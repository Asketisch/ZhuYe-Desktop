/**
 * F01:prompt_guard 裁决统计的类型(从 `./types` 拆出,保持单文件行数预算)。
 *
 * 状态语义:**进程级** —— guard 挂在引擎进程的 ToolRegistry(定义侧)
 * 与 ToolExecutionQueue(输出侧),计数是会话累计值,切会话不清零
 * (与 `PromptState` 同理)。
 */
export interface GuardStatsState {
  /** prompt_guard 是否启用(F01 起默认开启)。 */
  enabled: boolean;
  /** 外部工具定义扫描 Block、拒绝注册的累计次数。 */
  definitionsBlocked: number;
  /** 工具定义扫描 Review、放行标注的累计次数。 */
  definitionsReviewed: number;
  /** 工具输出扫描 Block、内容被拦截替换的累计次数。 */
  outputsBlocked: number;
  /** 工具输出扫描 Review、metadata 标注的累计次数。 */
  outputsReviewed: number;
}

/**
 * `queryGuardStats` 动作的实现(从 store.ts 拆出,保持单文件行数预算)。
 *
 * 应答 `guard_stats` 事件异步到达,reducer 写入 `guardStats`。
 * 依赖注入使本动作可脱离 zustand 单测。
 */
export async function runQueryGuardStats(
  invoke: () => Promise<unknown>,
): Promise<void> {
  await invoke();
}
