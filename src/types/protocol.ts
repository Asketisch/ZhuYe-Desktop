/**
 * Reflect protocol TypeScript 类型 —— 薄再导出 shim。
 *
 * 实际定义位于 `./protocol/`，每域一个文件：
 *   - protocol/event.ts           —— Tauri `reflect_event` 信封 +
 *                                    全部 EventMsg payload 结构 +
 *                                    `EventMsgByType` / `ReflectEventMsg`。
 *   - protocol/submission.ts      —— `ReflectSubmission` 信封。
 *   - protocol/op.ts              —— `ReflectSubmissionOp` 判别联合 +
 *                                    `OpType` + `ThreadSettingsOverrides`
 *                                    + `W3cTraceContext`。
 *   - protocol/item.ts            —— `UserInputItem` 判别联合。
 *   - protocol/question.ts        —— `Question` / `QuestionOption` /
 *                                    `Answer` / `AskUserAnswer`。
 *   - protocol/ask_user_input.ts  —— `AskUserInputPayload`（自由文本提示）。
 *   - protocol/rollout.ts         —— `ReflectSessionInfo` /
 *                                    `ReflectRolloutRecord`。
 *   - protocol/enums.ts           —— `PermissionMode`, `ApprovalPolicy`,
 *                                    `SandboxPolicy`, `RiskLevel`,
 *                                    `ReasoningEffort`, `ReviewDecision`。
 *   - protocol/usage.ts           —— `TokenUsagePayload`。
 *   - protocol/index.ts           —— barrel 再导出（本文件的来源）。
 *
 * 消费者应保持从 `@/types/protocol`（或相对路径 `./protocol`）导入——
 * 此前从此文件导出的所有名称仍以下方再导出。代码库中其他部分不应直接
 * 访问 `./protocol/*.ts`；按域拆分属内部组织事项。
 *
 * ## 协议同步警告
 *
 * 本目录（因此本 shim）**手动同步**于 `zhuye-agent/crates/protocol/reflect-protocol`
 * （Tauri IPC 信封的 Rust 模式）。领域模块与 Rust 类型之间的任何
 * 偏差会导致 wire-format bug。更新流程：
 *   1. 在 `zhuye-agent/crates/protocol/reflect-protocol/src/...` 编辑 Rust 枚举/变体。
 *   2. 在对应领域模块中镜像修改，保留 snake_case 字段名、判别符及
 *      `ReviewDecision::Deny` 的 `{ deny: { reason } }` 形状。
 *   3. 若涉及新事件类型，将其加入 `EventMsgType`、`EventMsgByType`
 *      及 `event.ts` 中的 `ReflectEventMsg` 映射类型。
 *   4. 运行 `pnpm typecheck` 和 `pnpm test` —— 必须保持通过。
 *
 * `scripts/dump-ts-types.sh`（Rust `dump_schema` 示例）可从 JSON Schema
 * 重新生成这些类型，但离线开发时本目录即为权威源。
 *
 * ## 不变量
 * 1. `id: string` 为每条 submission 的关联 ID（`EVENT_ID_NONE` 生命周期事件为 `""`）。
 * 2. `msg.type` 为 snake_case 判别符；通过 `EventMsgByType` 映射 +
 *    `ReflectEvent` 判别联合支持 TS 类型收窄。
 * 3. 所有 `UserInputItem` 变体与 Rust 枚举匹配。
 * 4. `ContentBlock` 与 Rust tool-output 枚举匹配。
 * 5. `ReviewDecision` 为 snake_case 标记枚举；`Deny` 携带 `{ reason: string }`
 *    payload（非 PascalCase）。
 */

export * from './protocol/index';
