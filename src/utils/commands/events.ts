/**
 * 实时 agent 输出的事件通道订阅。
 *
 * 对应 `src-tauri/src/state.rs` 的 `zhuye_event` 广播 —— payload 形态
 * 定义在 `src/types/protocol.ts`。
 */
import { listen } from '../bridge';
import type { ZhuyeEvent, ZhuyeSessionEvent } from '@/types/protocol';

/**
 * v1.12:`zhuye_event_gap` 的载荷 —— 转发器 broadcast `Lagged(n)` 时的
 * 缺口通知。合成应用级通知,不是 EventMsg 变体(不进引擎协议)。
 */
export interface ZhuyeEventGap {
  /** 丢弃的事件条数。 */
  dropped: number;
  /** 缺口作用域:前台主流 / 后台会话流。 */
  scope: 'foreground' | 'background';
  /** 后台缺口对应的会话 id;`null` = 前台缺口(broadcast 级丢弃不辨会话)。 */
  session_id?: string | null;
}

/**
 * 订阅 `zhuye_event_gap` 缺口通知(v1.12)。前端据此对当前会话(前台)
 * 或后台会话注册表(后台)触发重放重同步。
 */
export async function onZhuyeEventGap(handler: (gap: ZhuyeEventGap) => void) {
  return listen<ZhuyeEventGap>('zhuye_event_gap', (e) => handler(e.payload));
}

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
