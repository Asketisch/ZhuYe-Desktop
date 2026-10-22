/**
 * Goal mode 封装 —— 进入/退出目标模式(Op::EnterGoalMode / Op::ExitGoalMode, v1.2 P1)。
 *
 * core 侧收到 EnterGoalMode 后构造 GoalController:每轮 turn 结束自校验
 * (LM judge + 可选 verify_command),未完成则 steering 续作,完成则退出。
 */
import { invoke } from '../bridge';

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
 * 目标模式的**权威状态** —— 跑到第几轮 / LM 判定 / 累计 token / 被什么卡住。
 *
 * 目标模式**没有协议事件**(上游如此),所以此前 GUI 只能靠前端投影
 * (`goalActive: boolean`)猜「是否活跃」—— 投影在会话切换 / 后端 rebind
 * 后就会与真实状态脱节。后端补了 `reflect_goal_status` 读口后,这里拿
 * 得到真值。
 *
 * `null` = 没有活跃目标(未进目标模式 / 已退出 / 已到终态被清空)。
 */
export async function reflect_goal_status(): Promise<GoalState | null> {
  return invoke<GoalState | null>('reflect_goal_status');
}

/** 目标状态快照(镜像上游 `reflect_goal::GoalState` 的线格式)。 */
export interface GoalState {
  /** 目标文本。 */
  goal: string;
  /** 可选的校验命令(退出码 0 才算达成)。 */
  verify_command: string | null;
  /** token 预算上限(未声明 = 上游默认)。 */
  token_budget: number | null;
  /** `active` / `complete` / `blocked` / `budget_limited`。 */
  status: string;
  /** 累计 token(跨所有 goal turn)。 */
  tokens_used: number;
  /** 累计 goal turn 数。 */
  turn_count: number;
  /** 连续 blocked 计数(3-strike 规则)。 */
  consecutive_blocked_turns: number;
  /** 起始时刻(ISO-8601)。 */
  started_at: string;
  /** 每轮校验历史(最新在前 —— 后端按时间倒序给)。 */
  turns: Array<{
    turn_index: number;
    status_after: string;
    verdict: { verdict: string; evidence?: string[]; remaining?: string[]; reason?: string };
    command_passed: boolean | null;
    tokens_used_this_turn: number;
    at: string;
  }>;
}
