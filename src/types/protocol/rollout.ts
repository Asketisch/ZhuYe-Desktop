/**
 * Reflect 协议 —— Rollout / SessionInfo。
 *
 * 对应 `zhuye-agent/crates/protocol/reflect-protocol/src/rollout.rs`。这里的 `ReflectSessionInfo`
 * 接口是 Tauri 信封使用的 *协议* 形状(snake_case),与 `src/utils/types.ts`
 * 中的 `ReflectSessionInfo` 不同——后者是经 `@/utils/commands` 再导出的
 * *后端* (Rust crate) 形状,字段为 kebab-case 并含额外字段。请勿混淆两者。
 *
 * `ReflectRolloutRecord` 用 `seq`、`kind`、`timestamp` 包装
 * `ReflectSubmission` 或 `ReflectEvent`,用于回放。
 *
 * 顶层同步警告见 `./index.ts`。
 */

import type { ReflectSubmission } from './submission';
import type { ReflectEvent } from './event';

export interface ReflectSessionInfo {
  thread_id: string;
  name?: string;
  created_at: number;
  updated_at: number;
  message_count: number;
  token_total: number;
}

export interface ReflectRolloutRecord {
  seq: number;
  kind: 'submission' | 'event';
  timestamp: number;
  payload: ReflectSubmission | ReflectEvent;
}
