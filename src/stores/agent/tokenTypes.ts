/**
 * token 计量类型 —— 会话内的用量快照与模型级累计。
 *
 * 从 `types.ts` 拆出(`types.ts` 逼近 500 行预算,见 `AGENTS.md`
 * 「大文件例外说明」):这两个类型自成一体(引擎 `token_count` 事件的
 * 前端投影),且被 Inspector / Usage 视图 / reducer 共用。
 *
 * `types.ts` 重新导出它们 —— 既有导入路径(`@/stores/agent/types`)
 * 全部保持有效,调用方零改动。
 */

export interface TokenSnapshot {
  input: number;
  output: number;
  cached: number;
  /** cache_creation_input_tokens(M8)—— input 的子集,不加进 total。 */
  cacheWrite: number;
  total: number;
  /** 命中的 provider(v1.0 多 Provider 路由),未上报时为 null。 */
  provider?: string | null;
  /** 命中的 credential label,未上报时为 null。 */
  credentialLabel?: string | null;
  /**
   * v1.x 模型级统计:本轮实际命中的模型 spec(如 `"openai/gpt-4o"`)。
   * 旧引擎不上报该字段 → null。
   */
  model?: string | null;
  /** 最近一次 model 调用的费用(USD,引擎按价目表计算),模型未定价时为 null。 */
  cost: number | null;
  /** 会话累计费用(USD):Σ 每次 token_count 事件的 cost_usd。
   *  仅累计 live 事件;回放 hydrate 的历史不含(与 CompactionStats.tokensSaved 同策略)。 */
  sessionCost: number;
  /**
   * 会话累计 total token(Σ 每次 token_count 事件的 total_tokens)。
   *
   * 与 `total` 的区别:`total` 是**最后一次调用**的 total(用于上下文
   * 占比计算),`sessionTotal` 才是整个会话的累计量。
   */
  sessionTotal?: number;
  /**
   * 会话内**按模型**的累计用量(键 = model spec)。
   *
   * v1.x 模型级统计:引擎在 `token_count` 事件里带上本轮命中的模型,
   * 这里按模型分组累计,让 GUI 能回答「这次会话各花了多少」。
   * 旧引擎不上报 `model` → 该表为空。
   */
  byModel?: Record<string, LiveModelUsage>;
}

/** 单个模型的会话内累计用量(按 `token_count` 事件累加)。 */
export interface LiveModelUsage {
  /** 完整 model spec(如 `"openai/gpt-4o"`)。 */
  model: string;
  /** 命中的 provider;未上报时为 null。 */
  provider: string | null;
  /** LLM 调用次数。 */
  calls: number;
  input: number;
  output: number;
  /** cache_read 分段(input 子集)。 */
  cached: number;
  /** cache_creation 分段(input 子集)。 */
  cacheWrite: number;
  /** 计费总量(input + output)。 */
  total: number;
  /** 累计 USD(引擎按价目算好随事件携带;未定价模型累计为 0)。 */
  cost: number;
}
