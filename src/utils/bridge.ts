/**
 * Tauri IPC 桥接原语 —— `invoke` / `listen` + 降级回退。
 *
 * 在脱离 Tauri 上下文（浏览器 preview / Storybook / 测试）时静默 fallback
 * 到 `undefined` / noop unlisten，通过 `isMissingTauriInvokeError` 守卫识别。
 */
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen, type UnlistenFn } from '@tauri-apps/api/event';

function isMissingTauriInvokeError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return /IPC invoke/i.test(e.message) || /not in Tauri context/i.test(e.message);
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (e) {
    if (isMissingTauriInvokeError(e)) {
      console.warn(`[zhuye-gui] invoke('${cmd}') outside Tauri context`);
      return undefined as unknown as T;
    }
    throw e;
  }
}

export async function listen<T>(
  event: string,
  handler: (e: { payload: T }) => void,
): Promise<UnlistenFn> {
  try {
    return await tauriListen<T>(event, handler);
  } catch (e) {
    if (isMissingTauriInvokeError(e)) {
      console.warn(`[zhuye-gui] listen('${event}') outside Tauri context`);
      return () => {};
    }
    throw e;
  }
}