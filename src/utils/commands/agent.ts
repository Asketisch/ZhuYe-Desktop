/**
 * 活动 agent 转数的 Submission + 生命周期包装。
 *
 * 生命周期 / Op 包装各自返回发起方的 submission id，
 * 便于前端将其与实时 `zhuye_event` 流关联。
 */
import { invoke } from '../bridge';
import type { ZhuyeSubmission, UserInputItem } from '@/types/protocol';

/** Submission 入口。返回 submission id。 */
export async function zhuye_submit(s: ZhuyeSubmission): Promise<string> {
  return invoke<string>('zhuye_submit', { submission: s });
}

/**
 * 中断当前 agent turn。
 *
 * 只中断**在飞回合**,会话本身不受影响 —— 走 `Op::Interrupt`,核心取消
 * `active_turns` 表里的回合级令牌。会话级 cancel token 属于
 * `Op::Shutdown` 的语义,中断绝不能碰它(碰了会话就报废了)。
 *
 * 返回 submission id。
 */
export async function zhuye_interrupt(child_id?: string): Promise<string> {
  return child_id
    ? invoke<string>('zhuye_interrupt', { childId: child_id })
    : invoke<string>('zhuye_interrupt');
}

/**
 * v1.4 A2:回合中途转向 —— 不打断当前 turn,消息进会话转向队列,
 * 下一个 pre_loop 安全点收割注入;无在飞 turn 时随下一个 UserInput
 * turn 边界合并。`priority: 'now'` = 用户中途说话(直入);
 * `'attachment'` = 参考资料(system-reminder 包裹,缺省)。
 * 注入本身不发协议事件(仅落 recorder),调用方需乐观渲染。
 */
export async function zhuye_steer(
  items: UserInputItem[],
  priority?: 'now' | 'attachment',
): Promise<string> {
  return invoke<string>('zhuye_steer', { items, priority: priority ?? null });
}

/**
 * v1.4 C1:查询子代理状态快照。应答为 `subagent_status` 事件,经
 * zhuye_event 通道异步送达(reducer 写入 store)。`child_id` 缺省 =
 * 列出全部在飞 + 近期终态子代理。
 */
export async function zhuye_query_subagents(child_id?: string): Promise<string> {
  return invoke<string>('zhuye_query_subagents', { childId: child_id ?? null });
}

/**
 * 压缩当前会话历史。v1.x:`instructions` 为可选附加指示
 * （`/compact <指示>`），随 `Op::Compact` 下发并注入摘要 prompt。
 */
export async function zhuye_compact(instructions?: string): Promise<string> {
  return invoke<string>('zhuye_compact', { instructions: instructions ?? null });
}

/** 回退到上一个回合（省略参数则丢弃最后一条用户消息）。 */
export async function zhuye_rewind(to_turn_id?: string): Promise<string> {
  return invoke<string>('zhuye_rewind', { toTurnId: to_turn_id ?? null });
}

/** 关闭 agent 运行时。 */
export async function zhuye_shutdown(): Promise<string> {
  return invoke<string>('zhuye_shutdown');
}
