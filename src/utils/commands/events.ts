/**
 * 实时 agent 输出的事件通道订阅。
 *
 * 对应 `src-tauri/src/state.rs` 的 `reflect_event` 广播 —— payload 形态
 * 定义在 `src/types/protocol.ts`。
 */
import { listen } from '../bridge';
import type { ReflectEvent, ReflectSessionEvent } from '@/types/protocol';

/**
 * 订阅全局 `reflect_event` 通道。
 *
 * 返回的函数用于取消订阅(Tauri `UnlistenFn`)。
 */
export async function onReflectEvent(handler: (event: ReflectEvent) => void) {
  return listen<ReflectEvent>('reflect_event', (e) => handler(e.payload));
}

/**
 * 订阅后台会话事件通道 `reflect_session_event`(v1.x 后台持续运行):
 * 载荷 `{ session_id, event }`,由 `src/stores/backgroundSessions.ts` 消化,
 * 主 reducer 不处理(前台事件仍走 `onReflectEvent`)。
 */
export async function onReflectSessionEvent(handler: (payload: ReflectSessionEvent) => void) {
  return listen<ReflectSessionEvent>('reflect_session_event', (e) => handler(e.payload));
}
