/**
 * Reflect protocol —— barrel 再导出。
 *
 * 实际类型定义位于各领域模块：
 * `./{event,submission,op,item,question,ask_user_input,rollout,enums,usage}.ts`。
 * 本文件是整个代码库的唯一导入入口（通常通过 `@/types/protocol`）；
 * 父目录 `src/types/protocol.ts` 是从这里再导出的薄 shim。
 *
 * ## 协议同步警告
 *
 * 本目录与 `zhuye-agent/crates/protocol/reflect-protocol`（Tauri IPC 信封的 Rust 模式）**手动同步**。
 * 领域模块与 Rust 类型之间的任何偏差会导致 wire-format bug：
 *   - `ReflectEvent` / `ReflectEventMsg` ↔ `serde(rename_all = "snake_case")`
 *   - `ReflectSubmission` / `ReflectSubmissionOp` ↔ `Submission` / `Op`
 *   - `UserInputItem` ↔ `UserInputItem`
 *   - `Question` / `QuestionOption` / `Answer` / `AskUserAnswer` ↔
 *     `Question` / `QuestionOption` / `Answer` / `AskUserAnswer`
 *   - `AskUserInputPayload` ↔ `AskUserInputMsg`
 *   - `ReflectSessionInfo` / `ReflectRolloutRecord` ↔ `SessionInfo` / `RolloutRecord`
 *
 * ## 更新流程
 * 1. 在 `zhuye-agent/crates/protocol/reflect-protocol/src/...` 中编辑/添加 Rust 枚举/变体。
 * 2. 在对应的领域模块中镜像修改（保留 snake_case 字段名、判别符、
 *    `ReviewDecision::Deny` 的 `{ deny: { reason } }` 形状）。
 * 3. 若涉及新事件类型，将其加入 `EventMsgType`、`EventMsgByType`
 *    及 `event.ts` 中的 `ReflectEventMsg` 映射类型。
 * 4. 运行 `pnpm typecheck` 和 `pnpm test` —— 必须保持通过。
 * 5. `scripts/dump-ts-types.sh`（Rust `dump_schema` 示例）可从 JSON Schema
 *    重新生成这些类型，但离线开发时本目录即为权威源。
 *
 * ## 不变量
 * 1. `id: string` 为每条 submission 的关联 ID（`EVENT_ID_NONE` 生命周期事件为 `""`）。
 * 2. `msg.type` 为 snake_case 判别符；通过 `EventMsgByType` 映射 + `event.ts` 中的
 *    `ReflectEvent` 判别联合支持 TS 类型收窄。
 * 3. 所有 `UserInputItem` 变体与 Rust 枚举匹配。
 * 4. `ContentBlock` 与 Rust tool-output 枚举匹配。
 * 5. `ReviewDecision` 为 snake_case 标记枚举；`Deny` 携带 `{ reason: string }` payload
 *    （非 PascalCase）。
 */

// ----- 线束信封 / EventMsg -----
export {
  EVENT_ID_NONE,
  type EventMsgType,
  type EventMsgByType,
  type ReflectEvent,
  type ReflectEventMsg,
  type SessionConfiguredPayload,
  type TurnStartedPayload,
  type TurnCompletePayload,
  type TurnAbortedPayload,
  type TurnRewoundPayload,
  type AbortReasonPayload,
  type AgentMessagePayload,
  type AgentMessageDeltaPayload,
  type ThinkingDeltaPayload,
  type TokenCountPayload,
  type ToolCallBeginPayload,
  type ToolCallEndPayload,
  type ToolOutput,
  type ContentBlock,
  type ApprovalRequestPayload,
  type ApprovalKind,
  type AskUserQuestionPayload,
  type PermissionBubblePayload,
  type ContextCompactedPayload,
  type ErrorPayload,
  type StreamErrorPayload,
  type ConfigReloadedPayload,
  type RoutingPayload,
  type CollabStartedPayload,
  type CollabMessagePayload,
  type CollabFinishedPayload,
  type McpServerStartedPayload,
  type McpServerFailedPayload,
  type McpToolInvokedPayload,
  type LspServerStartedPayload,
  type LspServerFailedPayload,
  type PlanRequestPayload,
  type PlanReadyPayload,
  type PlanApprovedPayload,
  type PlanRejectedPayload,
  type PermissionModeChangedPayload,
  type ToolCallOutputDeltaPayload,
  type SubagentProgressKind,
  type SubagentProgressPayload,
  type SubagentRunState,
  type SubagentStatusSnapshot,
  type SubagentStatusPayload,
} from './event';

// ----- Submission / Op -----
export {
  type OpType,
  type ReflectSubmissionOp,
  type ThreadSettingsOverrides,
  type W3cTraceContext,
} from './op';
export type { ReflectSubmission } from './submission';

// ----- UserInputItem -----
export type { FileRange, UserInputItem } from './item';

// ----- Question / Answer -----
export type {
  Question,
  QuestionOption,
  Answer,
  AskUserAnswer,
} from './question';

// ----- AskUserInput -----
export type { AskUserInputPayload } from './ask_user_input';

// ----- Rollout / SessionInfo -----
export type { ReflectSessionInfo, ReflectRolloutRecord } from './rollout';

// ----- Shared enums -----
export type {
  PermissionMode,
  ApprovalPolicy,
  SandboxPolicy,
  RiskLevel,
  ReasoningEffort,
  ReviewDecision,
  PlanApprovalChoice,
} from './enums';

// ----- Usage -----
export type { TokenUsagePayload } from './usage';

// ----- 向后兼容别名（旧代码仍在导入这些名称） -----
export type { EventMsgType as ReflectEventType } from './event';
export type { OpType as ReflectSubmissionOpType } from './op';
export type { UserInputItem as ReflectUserInputItem } from './item';
