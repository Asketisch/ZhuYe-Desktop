/**
 * 会话统计 IPC 包装。
 *
 * 薄包装 `reflect_session_stats` / `reflect_all_model_usage`,只读扫描
 * rollout JSONL(`~/.zhuye/sessions/`)聚合出 token 用量、模型级拆分、
 * 压缩节省与记忆访问次数 —— GUI 对应 CLI `reflect session stats`。
 *
 * 类型与后端 `reflect_app_core::stats` 的 camelCase 出线对齐。
 */
import { invoke } from '@/utils/bridge';

/** 单模型累计用量。 */
export interface ModelUsage {
  /** 完整 model spec(如 `"openai/gpt-4o"`)。 */
  model: string;
  /** 命中的 provider 名;旧记录无该字段时为 null。 */
  provider?: string | null;
  /** LLM 调用次数。 */
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** cache_read 分段(input 子集)。 */
  cachedTokens: number;
  /** cache_creation 分段(input 子集)。 */
  cacheWriteTokens: number;
  totalTokens: number;
  /** 累计 USD cost;该模型不在 pricing 表时为 null。 */
  costUsd?: number | null;
}

/** 单会话统计。 */
export interface SessionStats {
  /** 会话 id(ThreadId uuid)。 */
  sessionId: string;
  /** 会话级默认模型(`SessionMeta.model`)。 */
  model: string;
  /** 会话开始时间(RFC3339)。 */
  startedAt: string;
  /** 消息条数。 */
  messageCount: number;
  /** 工具调用次数。 */
  toolCalls: number;
  /** 压缩次数。 */
  compactions: number;
  /** 各次压缩前上下文 token 估算之和。 */
  compactionBeforeTokens: number;
  /** 各次压缩后上下文 token 估算之和。 */
  compactionAfterTokens: number;
  /** 压缩累计节省的 token。 */
  compactionTokensSaved: number;
  /** 记忆检索注入次数。 */
  memoryReads: number;
  /** 记忆固化写入次数。 */
  memoryWrites: number;
  inputTokens: number;
  outputTokens: number;
  /** cache_read 分段(input 子集)。 */
  cachedTokens: number;
  /** cache_creation 分段(input 子集)。 */
  cacheWriteTokens: number;
  totalTokens: number;
  /** 累计 USD cost;无带价调用时为 null。 */
  costUsd?: number | null;
  /** 缓存命中率(`cached / input`);无 input 时为 null。 */
  cacheHitRate?: number | null;
  /** 按模型拆分的用量,按 totalTokens 降序。 */
  perModel: ModelUsage[];
}

/**
 * 单模型费率卡(核心静态费率表反解,桌面端不持有第二份费率表)。
 */
export interface RateCard {
  /** 完整 model spec(如 `"anthropic/claude-sonnet-4-latest"`)。 */
  model: string;
  /** 核心费率表里是否有该模型(本地免费 / 未知模型 → false)。 */
  priced: boolean;
  /** 每 1M 非缓存输入 token 的 USD 价格。 */
  inputPrice?: number | null;
  /** 输出倍率(相对 inputPrice)。 */
  outputFactor?: number | null;
  /** 缓存读取(cache_read)倍率。 */
  cacheReadFactor?: number | null;
  /** 缓存写入(cache_creation)倍率。 */
  cacheWriteFactor?: number | null;
  /** 每 1M 输出 token 的 USD 价格。 */
  outputPrice?: number | null;
  /** 每 1M 缓存读取 token 的 USD 价格。 */
  cacheReadPrice?: number | null;
  /** 每 1M 缓存写入 token 的 USD 价格。 */
  cacheWritePrice?: number | null;
}

/**
 * 查询一批模型的费率卡。
 *
 * 费率来自核心的静态费率表(读取侧反解),让 GUI 能解释费用构成;
 * 模型不在表内 → `priced: false`,不给编造的数字。
 */
export function reflect_model_rate_cards(models: string[]): Promise<RateCard[]> {
  return invoke('reflect_model_rate_cards', { models });
}

/**
 * 查询某会话的完整统计。
 *
 * 磁盘上还没有该 session 的 JSONL(刚创建未发消息)→ 返回 `null`。
 */
export function reflect_session_stats(id: string): Promise<SessionStats | null> {
  return invoke('reflect_session_stats', { id });
}

/** 查询全部会话的模型级用量(按总 token 降序)。 */
export function reflect_all_model_usage(): Promise<ModelUsage[]> {
  return invoke('reflect_all_model_usage');
}
