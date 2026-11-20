/**
 * 浏览器面板控制器:状态轮询 + 帧流订阅 + 启停动作。
 *
 * 帧(`zhuye_browser_frame`,base64 JPEG)到达即渲染;start/stop 走
 * 后端命令,状态刷新在挂载时做一次(status 无副作用)。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  zhuye_browser_start,
  zhuye_browser_status,
  zhuye_browser_stop,
  listen_browser_frame,
  type ZhuyeBrowserStatus,
} from '@/utils/commands/browser';

export interface BrowserViewState {
  /** 面板状态(null = 尚未查询)。 */
  status: ZhuyeBrowserStatus | null;
  /** 当前帧 data URL(`data:image/jpeg;base64,...`;无帧为 null)。 */
  frame: string | null;
  /** start/stop 进行中。 */
  busy: boolean;
  /** 动作失败信息(状态查询失败不进这里 —— 面板仍可重试)。 */
  error: string | null;
}

export function useBrowserController() {
  const [state, setState] = useState<BrowserViewState>({
    status: null,
    frame: null,
    busy: false,
    error: null,
  });
  // 帧订阅是异步 promise:卸载早于 resolve 时也要能 unlisten(同终端页惯例)。
  const unlistenRef = useRef<(() => void) | null>(null);

  const patch = (partial: Partial<BrowserViewState>) => {
    setState((prev) => ({ ...prev, ...partial }));
  };

  const refresh = useCallback(async () => {
    try {
      const status = await zhuye_browser_status();
      patch({ status, error: null });
    } catch (cause) {
      patch({
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }, []);

  // 挂载:查一次状态 + 订阅帧流。
  useEffect(() => {
    void refresh();
    let cancelled = false;
    listen_browser_frame((payload) => {
      patch({ frame: `data:image/jpeg;base64,${payload.data}` });
    }).then((un) => {
      if (cancelled) un();
      else unlistenRef.current = un;
    });
    return () => {
      cancelled = true;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, [refresh]);

  const start = useCallback(async () => {
    patch({ busy: true, error: null });
    try {
      const status = await zhuye_browser_start();
      patch({ status, busy: false });
    } catch (cause) {
      patch({
        busy: false,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }, []);

  const stop = useCallback(async () => {
    patch({ busy: true, error: null });
    try {
      const status = await zhuye_browser_stop();
      patch({ status, frame: null, busy: false });
    } catch (cause) {
      patch({
        busy: false,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }, []);

  return { ...state, start, stop, refresh };
}
