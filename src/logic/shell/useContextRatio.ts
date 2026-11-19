/**
 * useContextRatio —— 当前会话上下文窗口占比（多消费方共享）。
 *
 * 数据源：agentStore 的 `tokens`（token_count 事件）+ `contextWindowSize`
 * （session_configured）。窗口未知 / 尚无 token 上报时 ratio 为 null。
 * `warn` 阈值 80%（与 ContextUsage 一致；Reasonix 式压缩提示线）。
 */
import { useAgentStore } from '@/stores/agentStore';

export const CONTEXT_WARN_RATIO = 0.8;

export interface ContextRatio {
  ratio: number | null;
  pct: number | null;
  warn: boolean;
  windowSize: number | null;
  usedTokens: number;
}

export function useContextRatio(): ContextRatio {
  const tokens = useAgentStore((st) => st.tokens);
  const windowSize = useAgentStore((st) => st.contextWindowSize);
  const usedTokens = tokens?.total ?? 0;
  const ratio =
    tokens && windowSize && windowSize > 0 && usedTokens > 0
      ? Math.min(1, usedTokens / windowSize)
      : null;
  return {
    ratio,
    pct: ratio === null ? null : Math.round(ratio * 100),
    warn: ratio !== null && ratio >= CONTEXT_WARN_RATIO,
    windowSize,
    usedTokens,
  };
}
