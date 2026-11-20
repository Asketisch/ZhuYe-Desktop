/**
 * src/protocol/submissions.ts —— Submission 构造器（B1-03）。
 *
 * 前端构造的 `Submission` 负载的唯一权威来源。每个函数：
 *   1. 生成新的 `id`（或接受显式传入的 id）。
 *   2. 构建强类型的 `op` 负载。
 *   3. 返回可直接交给 `zhuye_submit` 的完整 `ZhuyeSubmission`。
 *
 * 为什么存在：
 *   此前调用方（`agentStore.submit`、弹窗、斜杠引擎）内联手写
 *   `Submission` 对象，导致 `id` 生成不一致和偶发字段缺失。集中于此：
 *   - 保证每个 Submission 都有唯一 id。
 *   - 为后续添加 `client_user_message_id` / `trace` 提供单一位置。
 *   - 让斜杠引擎（B4）与 store 调用同一套构造器。
 *
 * 命名约定：每个导出的构建器都是与 `Op` 变体对应的名词 + 动词组合。
 * 例如 `Op::ToolApproval` → `toolApproval(...)`。
 */

import {
  EVENT_ID_NONE,
  type AskUserAnswer,
  type PermissionMode,
  type PlanApprovalChoice,
  type ZhuyeSubmission,
  type ZhuyeSubmissionOp,
  type ReasoningEffort,
  type ReviewDecision,
  type UserInputItem,
} from '@/types/protocol';

// ====== ID 生成 ======

let __submissionCounter = 0;

/** 生成唯一的 submission id。当 `crypto.randomUUID` 不可用
 * （jsdom 测试环境）时回退到时间戳+计数器。
 */
export function newSubmissionId(prefix = 'sub'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  __submissionCounter += 1;
  return `${prefix}-${Date.now()}-${__submissionCounter}`;
}

/** 重置计数器（仅测试用）。 */
export function __resetSubmissionIdCounter(): void {
  __submissionCounter = 0;
}

// ====== Submission builder ======

/** 内部：构造带自动 id 的 Submission。 */
function build(op: ZhuyeSubmissionOp, id = newSubmissionId()): ZhuyeSubmission {
  return { id, op };
}

// ====== Per-Op constructors ======

/**
 * `Op::UserInput` —— 向 agent 提交一个或多个文本/图片/技能条目。
 * 大多数简单场景应使用 `userInputText`。
 */
export function userInput(
  items: UserInputItem[],
  threadSettings?: ZhuyeSubmission['op'] extends { type: 'user_input'; thread_settings?: infer T } ? T : never,
  id = newSubmissionId(),
): ZhuyeSubmission {
  const op: ZhuyeSubmissionOp = { type: 'user_input', items };
  if (threadSettings) (op as { thread_settings?: unknown }).thread_settings = threadSettings;
  return { id, op };
}

/** 便捷方法：提交单条文本消息。 */
export function userInputText(text: string, id = newSubmissionId()): ZhuyeSubmission {
  return userInput([{ type: 'text', text }], undefined, id);
}

/** 提交本地图片（文件路径）及可选说明文字。 */
export function userInputImage(path: string, text?: string, id = newSubmissionId()): ZhuyeSubmission {
  const items: UserInputItem[] = [{ type: 'local_image', path }];
  if (text) items.push({ type: 'text', text });
  return userInput(items, undefined, id);
}

/** 激活一个技能（B5：技能提及选择器）。 */
export function userInputSkill(name: string, args?: unknown, id = newSubmissionId()): ZhuyeSubmission {
  return userInput([{ type: 'skill', name, args }], undefined, id);
}

/** `Op::Compact` — trigger context compaction. */
export function compact(id = newSubmissionId()): ZhuyeSubmission {
  return build({ type: 'compact' }, id);
}

/** `Op::Interrupt` — 取消当前回合。 */
export function interrupt(id = newSubmissionId()): ZhuyeSubmission {
  return build({ type: 'interrupt' }, id);
}

/** `Op::Rewind` — 回退会话至之前的回合（未传 `to_turn_id` 时回到最后一条用户回合）。 */
export function rewind(toTurnId?: string | null, id = newSubmissionId()): ZhuyeSubmission {
  return build({ type: 'rewind', to_turn_id: toTurnId ?? null }, id);
}

/** `Op::Shutdown` — 优雅关闭 agent。 */
export function shutdown(id = newSubmissionId()): ZhuyeSubmission {
  return build({ type: 'shutdown' }, id);
}

/** `Op::ToolApproval` — 批准 / 拒绝 / 本次会话内批准某个工具调用。 */
export function toolApproval(
  id_: string,
  decision: ReviewDecision,
  id = newSubmissionId(),
): ZhuyeSubmission {
  return build({ type: 'tool_approval', id: id_, decision }, id);
}

/** `Op::HookApproval` — 批准 / 拒绝某个钩子决策。 */
export function hookApproval(
  id_: string,
  decision: ReviewDecision,
  id = newSubmissionId(),
): ZhuyeSubmission {
  return build({ type: 'hook_approval', id: id_, decision }, id);
}

/** `Op::PlanApproval` — plan 审批三选一(auto_mode / manual_approve / revise)。 */
export function planApproval(
  id_: string,
  choice: PlanApprovalChoice,
  id = newSubmissionId(),
): ZhuyeSubmission {
  return build({ type: 'plan_approval', id: id_, choice }, id);
}

/** `Op::EnterPlanMode` — 请求进入计划模式。 */
export function enterPlanMode(task: string, id = newSubmissionId()): ZhuyeSubmission {
  return build({ type: 'enter_plan_mode', task }, id);
}

/** `Op::ExitPlanMode` — 请求退出计划模式。 */
export function exitPlanMode(id = newSubmissionId()): ZhuyeSubmission {
  return build({ type: 'exit_plan_mode' }, id);
}

/** `Op::SetEffort` — 设置推理强度。 */
export function setEffort(effort: ReasoningEffort, id = newSubmissionId()): ZhuyeSubmission {
  return build({ type: 'set_effort', effort }, id);
}

/** `Op::SetPermissionMode` — 切换到指定权限模式。 */
export function setPermissionMode(mode: PermissionMode, id = newSubmissionId()): ZhuyeSubmission {
  return build({ type: 'set_permission_mode', mode }, id);
}

/** `Op::CyclePermissionMode` — 在 UI 循环中切换到下一个权限模式。 */
export function cyclePermissionMode(id = newSubmissionId()): ZhuyeSubmission {
  return build({ type: 'cycle_permission_mode' }, id);
}

/** `Op::AskUserQuestionResponse` — 回答结构化问题。 */
export function askUserQuestionResponse(
  id_: string,
  answers: AskUserAnswer,
  id = newSubmissionId(),
): ZhuyeSubmission {
  return build({ type: 'ask_user_question_response', id: id_, answers }, id);
}

/** `Op::AskUserInputResponse` — 回答自由文本输入问题。 */
export function askUserInputResponse(
  id_: string,
  text: string,
  id = newSubmissionId(),
): ZhuyeSubmission {
  return build({ type: 'ask_user_input_response', id: id_, text }, id);
}

// ====== 再导出事件常量 ======
export { EVENT_ID_NONE };
