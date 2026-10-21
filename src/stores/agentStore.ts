/**
 * 模块化 agent store 的兼容性入口。
 *
 * 实现位于 `./agent`；来自 `@/stores/agentStore` 的现有导入
 * 有意保持稳定。
 */
export {
  reduceEvent,
  selectHasPendingInteraction,
  selectIsTurnRunning,
  useAgent,
  useAgentStore,
} from './agent';
export type {
  AgentSession,
  AgentState,
  CollabMessage,
  CollabSession,
  LspServerEntry,
  McpInvocation,
  McpServerEntry,
  PendingApproval,
  PendingAskUser,
  PendingPlan,
  PendingQuestion,
  QueuedMessage,
  RoutingSnapshot,
  SubagentProgressEntry,
  SubagentsState,
  Toast,
  ToastKind,
  TodoItem,
  TokenSnapshot,
  Turn,
  TurnItem,
  TurnStatus,
} from './agent';
