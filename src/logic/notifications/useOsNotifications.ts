/**
 * useOsNotifications —— F64/F50 OS 通知扩展。
 *
 * 订阅 agentStore 事件,在两类关键节点发系统通知(Web Notification API,
 * Tauri WebView 支持):
 *
 * - **turn_complete**(仅窗口失焦时)—— 长回合跑完提醒回来看结果;
 * - **approval_request**(无条件)—— 审批卡等用户决策,可能长时间挂起。
 *
 * 为什么用 Web Notification 而非新增 Rust 命令:Tauri WebView 暴露的
 * Notification API 经 OS 桥接已产生真实系统通知,无需 plugins/ 权限
 * 配置;engine 侧 `zhuye-integration::NotificationDelivery`(F64)的
 * 多通道路由在桌面端由本 hook 承担 System 通道。
 *
 * 权限:首次请求 Notification.requestPermission;被拒后静默停用。
 */
import { useEffect, useRef, useState } from 'react';
import { useAgentStore } from '@/stores/agentStore';

const STORE_KEY = 'osNotifications.enabled';

/** localStorage 子集(注入以便测试)。 */
interface KeyValueStore {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
}

/** 通知开关读取(纯函数,storage 注入以便测试)。 */
export function readEnabled(store: Pick<KeyValueStore, 'getItem'>): boolean {
  return store.getItem(STORE_KEY) === '1';
}

/** 写通知开关。 */
export function writeEnabled(store: Pick<KeyValueStore, 'setItem'>, on: boolean): void {
  store.setItem(STORE_KEY, on ? '1' : '0');
}

/** 请求通知权限。返回是否 granted。 */
export async function requestPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

/** 是否窗口聚焦(Tauri WebView 下 document.hasFocus 足够)。 */
function isFocused(): boolean {
  return typeof document !== 'undefined' && document.hasFocus();
}

/** fire 一个系统通知(权限 granted 才发)。 */
export function fireNotification(title: string, body: string): boolean {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return false;
  }
  try {
    new Notification(title, { body, silent: false });
    return true;
  } catch {
    return false;
  }
}

/** 订阅 agentStore,挂接 OS 通知。返回清理函数。 */
export function useOsNotifications(): { enabled: boolean; setEnabled: (on: boolean) => Promise<void> } {
  const [enabled, setEnabledState] = useState(() => {
    const fallback = { getItem: () => null };
    return readEnabled(typeof localStorage !== 'undefined' ? localStorage : fallback);
  });

  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled) {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      return;
    }
    void requestPermission();
    const store = useAgentStore;
    let lastTurnId: string | null = null;
    const unsub = store.subscribe((state) => {
      // turn_complete:仅失焦时通知(聚焦时用户已在看)。
      const lastTurn = state.turns[state.turns.length - 1];
      if (lastTurn && lastTurn.id !== lastTurnId && lastTurn.status === 'done') {
        lastTurnId = lastTurn.id;
        if (!isFocused()) {
          fireNotification('回合完成', '长回合已跑完,点击查看结果。');
        }
      }
      // approval_request:无条件通知。
      const pending = state.pendingApprovals[state.pendingApprovals.length - 1];
      if (pending) {
        fireNotification('需要审批', `${pending.toolName ?? 'agent'} 等待你的决定。`);
      }
    });
    unsubscribeRef.current = unsub;
    return () => {
      unsub();
      unsubscribeRef.current = null;
    };
  }, [enabled]);

  const setEnabled = async (on: boolean) => {
    if (on) await requestPermission();
    writeEnabled(localStorage, on); // Storage 满足 Pick 子集
    setEnabledState(on);
  };

  return { enabled, setEnabled };
}
