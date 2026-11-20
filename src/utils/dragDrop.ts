/**
 * Tauri webview 原生拖拽桥 —— `getCurrentWebview().onDragDropEvent` 的
 * 降级封装。
 *
 * 为什么不用 DOM `dataTransfer.files`:Tauri 的 WKWebView(macOS)/部分
 * 平台下,从 Finder 拖入的文件**不会**填充 DOM drag 事件的 `files`,只有
 * 原生 `onDragDropEvent` 能给出真实路径。脱离 Tauri 上下文(浏览器
 * preview / vitest)时静默降级为 noop unlisten,Composer 回退 DOM drop。
 */
import { getCurrentWebview } from '@tauri-apps/api/webview';

export interface WebviewDragDropHandlers {
  /** 拖入 / 悬停(携带 paths 仅 enter 时有值)。 */
  onOver?: (paths: string[]) => void;
  /** 拖离窗口。 */
  onLeave?: () => void;
  /** 放下文件。 */
  onDrop: (paths: string[]) => void;
}

/**
 * 订阅 webview 拖拽事件。成功返回 unlisten;非 Tauri 上下文降级返回
 * `null`（调用方据此保留 DOM drop 兜底），绝不抛错。
 */
export async function onWebviewDragDrop(
  handlers: WebviewDragDropHandlers,
): Promise<(() => void) | null> {
  try {
    const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === 'enter') {
        handlers.onOver?.(payload.paths);
      } else if (payload.type === 'over') {
        handlers.onOver?.([]);
      } else if (payload.type === 'drop') {
        handlers.onDrop(payload.paths);
      } else {
        handlers.onLeave?.();
      }
    });
    return unlisten;
  } catch {
    console.warn('[zhuye-gui] webview drag-drop events unavailable outside Tauri context');
    return null;
  }
}
