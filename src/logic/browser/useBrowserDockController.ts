/**
 * useBrowserDockController —— 右 dock「浏览器」面板的状态与动作。
 *
 * 职责:
 * - 挂载时查询一次状态(**不自动启动**:status 无副作用)+ 订阅
 *   `zhuye_browser_frame` 帧流(base64 JPEG → data URL)。
 * - 启停:zhuye_browser_start / stop;start/stop 后回写状态。
 * - 导航:地址栏草稿(Enter 提交)与后退/前进/刷新,均由后端开短连接
 *   page 级 CDP 命令完成;动作失败进入 error(面板可重试)。
 * - 设备模拟:预设尺寸(桌面/平板/手机)在前端持有,后端只应用 metrics;
 *   未启动时只记录档位,不发起命令。
 *
 * 地址栏草稿跟随真实 URL:仅当 status.url 变化时覆写(设备切换等
 * 状态刷新不打断输入中的草稿)。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listen_browser_frame,
  zhuye_browser_back,
  zhuye_browser_forward,
  zhuye_browser_navigate,
  zhuye_browser_reload,
  zhuye_browser_set_device,
  zhuye_browser_start,
  zhuye_browser_status,
  zhuye_browser_stop,
  type ZhuyeBrowserStatus,
} from '@/utils/commands/browser';

/** 设备档位标识(渲染层只收字符串,不反依赖逻辑层)。 */
export type BrowserDevicePreset = 'desktop' | 'tablet' | 'phone';

/** 设备预设尺寸(与 i18n 文案一一对应;后端只应用 metrics)。 */
export const BROWSER_DEVICE_PRESETS: Record<BrowserDevicePreset, { width: number; height: number }> = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
  phone: { width: 390, height: 844 },
};

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function useBrowserDockController() {
  const [status, setStatus] = useState<ZhuyeBrowserStatus | null>(null);
  /** 当前帧 data URL(`data:image/jpeg;base64,...`;无帧为 null)。 */
  const [frame, setFrame] = useState<string | null>(null);
  /** 启停/导航/设备切换进行中。 */
  const [busy, setBusy] = useState(false);
  /** 动作失败信息(状态查询失败也进这里 —— dock 每次动作都会重试)。 */
  const [error, setError] = useState<string | null>(null);
  /** 当前设备档位(本地状态;后端只在运行中应用 metrics)。 */
  const [device, setDevice] = useState<BrowserDevicePreset>('desktop');
  /** 地址栏草稿。 */
  const [urlDraft, setUrlDraft] = useState('');
  // 帧订阅是异步 promise:卸载早于 resolve 时也要能 unlisten(同面板页惯例)。
  const unlistenRef = useRef<(() => void) | null>(null);

  const running = status?.running ?? false;

  // 地址栏草稿跟随真实 URL:URL 变化才覆写。
  useEffect(() => {
    setUrlDraft(status?.url ?? '');
  }, [status?.url]);

  // 挂载:查一次状态(不自动启动)+ 订阅帧流。
  useEffect(() => {
    let cancelled = false;
    zhuye_browser_status()
      .then((next) => {
        if (cancelled) return;
        setStatus(next);
        setError(null);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(messageOf(cause));
      });
    listen_browser_frame((payload) => {
      setFrame(`data:image/jpeg;base64,${payload.data}`);
    }).then((un) => {
      if (cancelled) un();
      else unlistenRef.current = un;
    });
    return () => {
      cancelled = true;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, []);

  /** 统一动作包装:busy + 错误捕获 + 状态回写(可选清帧)。 */
  const run = useCallback(
    async (action: () => Promise<ZhuyeBrowserStatus>, opts?: { resetFrame?: boolean }) => {
      setBusy(true);
      setError(null);
      try {
        const next = await action();
        setStatus(next);
        if (opts?.resetFrame) setFrame(null);
      } catch (cause) {
        setError(messageOf(cause));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const start = useCallback(() => {
    void run(() => zhuye_browser_start());
  }, [run]);

  const stop = useCallback(() => {
    void run(() => zhuye_browser_stop(), { resetFrame: true });
  }, [run]);

  // 地址栏提交:trim 交给后端,scheme 补全在后端 normalize_url(单一事实源)。
  const navigate = useCallback(() => {
    const target = urlDraft.trim();
    if (!target) return;
    void run(() => zhuye_browser_navigate(target));
  }, [run, urlDraft]);

  const back = useCallback(() => {
    void run(() => zhuye_browser_back());
  }, [run]);

  const forward = useCallback(() => {
    void run(() => zhuye_browser_forward());
  }, [run]);

  const reload = useCallback(() => {
    void run(() => zhuye_browser_reload());
  }, [run]);

  /** 切换设备档位:未启动只记录档位(不发起命令);运行中应用 metrics。 */
  const changeDevice = useCallback(
    (id: string) => {
      const preset = id as BrowserDevicePreset;
      const metrics = BROWSER_DEVICE_PRESETS[preset];
      if (!metrics) return;
      setDevice(preset);
      if (!running) return;
      void run(() => zhuye_browser_set_device(metrics.width, metrics.height));
    },
    [run, running],
  );

  return {
    running,
    status,
    frame,
    busy,
    error,
    device,
    urlDraft,
    setUrlDraft,
    navigate,
    back,
    forward,
    reload,
    start,
    stop,
    changeDevice,
  };
}
