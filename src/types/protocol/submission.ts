/**
 * Reflect protocol —— Submission 信封。
 *
 * 对应 `zhuye-agent/crates/protocol/reflect-protocol/src/submission.rs` 的 `Submission`。
 * Rust 端序列化为 `{ id, op, client_user_message_id?, trace?, workspace? }`；
 * `op` payload 为 `./op.ts` 中的判别联合。
 *
 * v1.x:顶层加 `workspace?: string` —— GUI 在 "+ New Chat" 创建/恢复时
 * 把当前 workspace 注入,后端据此写入 `SessionMeta.workspace` 并把
 * `Submission` 与该 session 归属绑定。`undefined` / `null` 表示不指定
 * (CLI / 测试场景),此时后端回退到 `cfg.current_workspace()`。
 *
 * 构造函数位于 `src/protocol/submissions.ts`（每个 Op 变体一个 builder）。
 * 请使用这些构造函数，不要手动构造 `ReflectSubmission` 对象。
 *
 * 顶层同步警告见 `./index.ts`。
 */

import type { ReflectSubmissionOp } from './op';
import type { W3cTraceContext } from './op';

export interface ReflectSubmission {
  id: string;
  op: ReflectSubmissionOp;
  client_user_message_id?: string;
  trace?: W3cTraceContext;
  /** v1.x:会话归属工作区(绝对路径)。 */
  workspace?: string;
}
