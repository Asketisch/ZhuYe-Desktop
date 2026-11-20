/**
 * 实时 agent 输出的事件通道订阅。
 *
 * 对应 `src-tauri/src/state.rs` 的 `zhuye_event` 广播 —— payload 形态
 * 定义在 `src/types/protocol.ts`。
 */
import { listen } from '../bridge';
import type { ZhuyeEvent, ZhuyeSessionEvent } from '@/types/protocol';

/**
 * 订阅全局 `zhuye_event` 通道。
 *
 * 返回的函数用于取消订阅(Tauri `UnlistenFn`)。
 */
export async function onZhuyeEvent(handler: (event: ZhuyeEvent) => void) {
  return listen<ZhuyeEvent>('zhuye_event', (e) => handler(e.payload));
}

/**
 * 订阅后台会话事件通道 `zhuye_session_event`(v1.x 后台持续运行):
 * 载荷 `{ session_id, event }`,由 `src/stores/backgroundSessions.ts` 消化,
 * 主 reducer 不处理(前台事件仍走 `onZhuyeEvent`)。
 */
export async function onZhuyeSessionEvent(handler: (payload: ZhuyeSessionEvent) => void) {
  return listen<ZhuyeSessionEvent>('zhuye_session_event', (e) => handler(e.payload));
}
