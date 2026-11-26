/**
 * cacheHitRate —— 缓存命中率的两个口径（多消费方共享）。
 *
 * **两个来源，两个口径，各标各的**：
 * - **回合级**（工作台 / 检查器）：本回合逐次调用的累计量
 *   `Σcached / Σinput`，与引擎回合收尾补发的回合累计一致；
 * - **会话级**（用量面板 / 用量页）：后端 `zhuye_session_stats` 的会话
 *   累计量（token 加权）。
 *
 * 命中率是**比例**，一律钳到 `[0, 100%]` —— 上游口径漂移（缓存分段未折入
 * `input`）时不会把 1052% 这种荒谬值抛到界面上。
 */
import { useAgentStore } from '@/stores/agentStore';

/**
 * 把「缓存读 / 输入」折成百分比并钳到 `[0, 100]`；输入为 0 时返回 null。
 */
export function cacheHitPercent(cached: number, input: number): number | null {
  if (!(input > 0)) return null;
  return clampRate01(cached / input) * 100;
}

/**
 * 把「比例」钳到 `[0, 1]`（展示层最后一道防线）。
 */
export function clampRate01(rate: number): number {
  if (!Number.isFinite(rate)) return 0;
  return Math.min(1, Math.max(0, rate));
}

/**
 * 本回合的缓存命中率（回合级口径，百分比）。
 *
 * 数据源是 store 的 `tokens.turn` —— reducer 按回合累加逐次调用得到，
 * 回合收尾时由引擎的回合累计事件校准。无数据时为 null。
 */
export function useTurnCacheHitRate(): number | null {
  const turn = useAgentStore((st) => st.tokens?.turn);
  return turn ? cacheHitPercent(turn.cached, turn.input) : null;
}
