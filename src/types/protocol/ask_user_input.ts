/**
 * Reflect protocol —— AskUserInput payload（自由文本提示）。
 *
 * 对应 `zhuye-agent/crates/protocol/zhuye-protocol/src/ask_user_input.rs` 的 `AskUserInputEvent`。
 * 区别于 `ask_user_question`（结构化多选）。Rust 端使用 `request_id`
 * 以便前端将最终的 `Op::AskUserInputResponse` 关联到正确的提示。
 *
 * 顶层同步警告见 `./index.ts`。
 */

export interface AskUserInputPayload {
  request_id: string;
  prompt: string;
  secret?: boolean;
  placeholder?: string;
}
