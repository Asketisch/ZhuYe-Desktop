/**
 * src/services/agentEventBus.ts —— B1-06 扇出事件总线。
 *
 * 架构:
 *   - 此模块持有唯一的 Tauri `zhuye_event` 订阅。
 *   - 多个 consumer(agentStore、Inspector、Notifications、DevTools 等)
 *     调用 `subscribeAgentEvent(callback)`,各自接收每个事件。
 *   - Fan-out 为一对多:共享底层 Tauri `listen`,避免为同一通道
 *     开启 N 个独立的 webview 监听器。
 *   - Consumer 回调彼此隔离 —— 单个 consumer 抛错不会影响其他 consumer。
 *
 * 用法:
 *   // agentStore 中:
 *   useEffect(() => {
 *     const un = subscribeAgentEvent((e) => applyPatch(e));
 *     return un;
 *   }, []);
 *
 *   // dev / inspector panel 中:
 *   useEffect(() => {
 *     const un = subscribeAgentEvent((e) => recordEvent(e));
 *     return un;
 *   }, []);
 *
 * 首次调用 `subscribeAgentEvent` 时打开 Tauri listener(幂等);
 * 最后一个 `unsubscribe` 调用时关闭它。这由内部引用计数处理。
 */
import { onZhuyeEvent } from '@/utils/commands';
import type { ZhuyeEvent } from '@/types/protocol';

type AgentEventHandler = (event: ZhuyeEvent) => void;

let __listeners: Set<AgentEventHandler> = new Set();
let __unlisten: (() => void) | null = null;
let __refCount = 0;
let __opening: Promise<void> | null = null;

/**
 * 订阅所有 `zhuye_event` 事件。返回取消订阅函数。
 *
 * 延迟连接:首次订阅时才打开底层 Tauri `listen`,并保持打开直到所有
 * 订阅者都取消订阅。
 */
export function subscribeAgentEvent(handler: AgentEventHandler): () => void {
  if (__listeners.has(handler)) {
    // 幂等:用同一函数重新订阅时返回同样的 cleanup。
    return () => unsubscribeAgentEvent(handler);
  }
  __listeners.add(handler);
  __refCount += 1;
  if (!__unlisten && !__opening) {
    __opening = openListener();
  }
  return () => unsubscribeAgentEvent(handler);
}

function unsubscribeAgentEvent(handler: AgentEventHandler): void {
  if (!__listeners.delete(handler)) return;
  __refCount -= 1;
  if (__refCount <= 0) {
    __refCount = 0;
    closeListener();
  }
}

async function openListener(): Promise<void> {
  try {
    const un = await onZhuyeEvent((e) => {
      // Fan-out:遍历快照,允许 handler 在 dispatch 中同步取消自身,
      // 不会破坏迭代。
      for (const handler of Array.from(__listeners)) {
        try {
          handler(e);
        } catch (err) {
          // 错误隔离:记录日志但不影响其他 consumer。
          // eslint-disable-next-line no-console
          console.error('[agentEventBus] consumer threw', err);
        }
      }
    });
    // 若等待期间所有订阅者都已取消订阅,立即关闭。
    if (__refCount <= 0) {
      un();
      return;
    }
    __unlisten = un;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[agentEventBus] failed to open Tauri listener', e);
  } finally {
    __opening = null;
  }
}

function closeListener(): void {
  if (__unlisten) {
    try {
      __unlisten();
    } catch {
      // ignore
    }
    __unlisten = null;
  }
  __listeners.clear();
}

/** 仅测试使用:重置模块状态。 */
export function __resetAgentEventBusForTests(): void {
  closeListener();
  __refCount = 0;
  __listeners = new Set();
  __opening = null;
}

/** 诊断:当前活跃的订阅者数量。 */
export function agentEventBusSubscriberCount(): number {
  return __refCount;
}
