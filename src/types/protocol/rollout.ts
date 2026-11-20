/**
 * 上游协议 —— Rollout / SessionInfo。
 *
 * 对应 `zhuye-agent/crates/protocol/zhuye-protocol/src/rollout.rs`。这里的 `ZhuyeSessionInfo`
 * 接口是 Tauri 信封使用的 *协议* 形状(snake_case),与 `src/utils/types.ts`
 * 中的 `ZhuyeSessionInfo` 不同——后者是经 `@/utils/commands` 再导出的
 * *后端* (Rust crate) 形状,字段为 kebab-case 并含额外字段。请勿混淆两者。
 *
 * `ZhuyeRolloutRecord` 用 `seq`、`kind`、`timestamp` 包装
 * `ZhuyeSubmission` 或 `ZhuyeEvent`,用于回放。
 *
 * 顶层同步警告见 `./index.ts`。
 */

import type { ZhuyeSubmission } from './submission';
import type { ZhuyeEvent } from './event';

export interface ZhuyeSessionInfo {
  thread_id: string;
  name?: string;
  created_at: number;
  updated_at: number;
  message_count: number;
  token_total: number;
}

export interface ZhuyeRolloutRecord {
  seq: number;
  kind: 'submission' | 'event';
  timestamp: number;
  payload: ZhuyeSubmission | ZhuyeEvent;
}
