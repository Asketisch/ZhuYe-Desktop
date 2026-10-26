/**
 * Goal mode 封装 —— 进入/退出目标模式(Op::EnterGoalMode / Op::ExitGoalMode, v1.2 P1)。
 *
 * core 侧收到 EnterGoalMode 后构造 GoalController:每轮 turn 结束自校验
 * (LM judge + 可选 verify_command),未完成则 steering 续作,完成则退出。
 *
 * v1.7:上游补了 `GoalController::snapshot()` 读口 —— 目标模式没有协议
 * 事件,快照是「是否活跃 / 跑到第几轮 / LM 判定 / 累计 token」的唯一
 * 权威读口,前端投影(goalActive)在会话切换 / rebind 后以此校准。
 */
import { invoke } from '../bridge';

/** 目标状态(v1.7 快照读口;snake_case 出线,镜像 Rust `GoalStatus`)。 */
export type GoalStatusWire = 'active' | 'paused' | 'blocked' | 'budget_limited' | 'complete';

/** LLM 自校验判定(镜像 Rust `GoalVerdict`,internally tagged)。 */
export type GoalVerdictWire =
  | { verdict: 'met'; evidence: string[] }
  | { verdict: 'unmet'; remaining: string[] }
  | { verdict: 'blocked'; reason: string };

/** 单轮校验记录(镜像 Rust `GoalTurnRecord`)。 */
export interface GoalTurnRecordPayload {
  turn_index: number;
  status_after: GoalStatusWire;
  verdict: GoalVerdictWire;
  /** 可选命令校验结果(若有 verify_command)。 */
  command_passed: boolean | null;
  tokens_used_this_turn: number;
  at: string;
}

/** 目标模式运行时快照(镜像 Rust `reflect_goal::GoalState`)。 */
export interface GoalSnapshotPayload {
  goal: string;
  verify_command: string | null;
  token_budget: number | null;
  status: GoalStatusWire;
  /** 累计 token(跨所有 goal turn)。 */
  tokens_used: number;
  /** 累计 goal turn 数。 */
  turn_count: number;
  /** 连续 blocked 计数(3-strike 规则,达 3 标 blocked)。 */
  consecutive_blocked_turns: number;
  started_at: string;
  /** 每轮校验历史。 */
  turns: GoalTurnRecordPayload[];
}

/** 进入目标模式;返回 submission id。 */
export async function reflect_enter_goal_mode(
  goal: string,
  verifyCommand?: string,
  tokenBudget?: number,
): Promise<string> {
  return invoke<string>('reflect_enter_goal_mode', { goal, verifyCommand, tokenBudget });
}

/** 退出目标模式,停止自动续作;返回 submission id。 */
export async function reflect_exit_goal_mode(): Promise<string> {
  return invoke<string>('reflect_exit_goal_mode');
}

/**
 * 读取目标模式状态快照。未进入目标模式(或 rebind 丢控制器)返回 `null`。
 * 前端 invoke 形态:`invoke<GoalSnapshotPayload | null>('reflect_goal_snapshot')`。
 */
export async function reflect_goal_snapshot(): Promise<GoalSnapshotPayload | null> {
  return invoke<GoalSnapshotPayload | null>('reflect_goal_snapshot');
}
