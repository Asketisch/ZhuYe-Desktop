/**
 * Reflect protocol —— Token 用量统计结构。
 *
 * 对应 `zhuye-agent/crates/protocol/reflect-protocol/src/usage.rs`。被 `TurnCompletePayload`、
 * `CollabMessagePayload` 共享，并被 `TokenCountPayload` 扩展（见 `./event.ts`）。
 *
 * 顶层同步警告见 `./index.ts`。
 */

export interface TokenUsagePayload {
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  cost_usd?: number;
  provider?: string;
  credential_label?: string;
}
