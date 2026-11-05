/**
 * Reflect protocol —— UserInputItem 判别联合。
 *
 * 对应 `zhuye-agent/crates/protocol/reflect-protocol/src/item.rs` 中的 `UserInputItem`。每个
 * 变体使用 `type` discriminator 标记,与 Rust 的
 * `#[serde(rename_all = "snake_case")]` 枚举对齐。`question_answer` 变体
 * 引用 `AskUserAnswer`(见 `./question.ts`)。
 *
 * v1.x:新增 `File` 变体 + `FileRange`(B-工作区归属)——
 * Composer `@` 弹层选中的文件。`path` 为相对工作区的 POSIX 路径,
 * 真实读取由后端 `/read` 工具按需触发(避免无谓 IO)。
 *
 * 顶层同步警告见 `./index.ts`。
 */

import type { AskUserAnswer } from './question';

/** 文件引用行区间,1-indexed 且含端点。`None` = 整文件引用。 */
export interface FileRange {
  start_line: number;
  end_line: number;
}

export type UserInputItem =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mime_type: string }
  | { type: 'local_image'; path: string }
  | { type: 'skill'; name: string; args?: unknown }
  | { type: 'question_answer'; request_id: string; answers: AskUserAnswer }
  | { type: 'file'; path: string; range?: FileRange };
