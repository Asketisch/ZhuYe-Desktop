/**
 * useBrowserDockController —— 右 dock「浏览器」面板的状态与动作。
 *
 * 职责:
 * - 挂载时先订阅 `zhuye_browser_frame`，再查询状态；已有帧流则
 *   调幂等启动重放最近帧，不自动启动尚未运行的浏览器。
 * - 启停:zhuye_browser_start / stop;start/stop 后回写状态。
 * - 导航:地址栏草稿(Enter 提交)与后退/前进/刷新,均由后端开短连接
 *   page 级 CDP 命令完成;动作失败进入 error(面板可重试)。
 * - 设备模拟：档位保存在 sessionStorage；未启动时记录档位，启动和
 *   重进面板时在持久页面连接上应用尺寸。
 *
 * 地址栏草稿跟随真实 URL:仅当 status.url 变化时覆写(设备切换等
 * 状态刷新不打断输入中的草稿)。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listen_browser_frame,
  zhuye_browser_back,
  zhuye_browser_forward,
  zhuye_browser_input,
  zhuye_browser_navigate,
  zhuye_browser_reload,
  zhuye_browser_set_device,
  zhuye_browser_start,
  zhuye_browser_status,
  zhuye_browser_stop,
  type ZhuyeBrowserStatus,
  type ZhuyeBrowserInputEvent,
} from '@/utils/commands/browser';

/** 设备档位标识(渲染层只收字符串,不反依赖逻辑层)。 */
export type BrowserDevicePreset = 'desktop' | 'tablet' | 'phone';

/** 设备预设尺寸(与 i18n 文案一一对应;后端只应用 metrics)。 */
export const BROWSER_DEVICE_PRESETS: Record<BrowserDevicePreset, { width: number; height: number }> = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
  phone: { width: 390, height: 844 },
};

const DEVICE_STORAGE_KEY = 'zhuye.browser.device';

function loadDevice(): BrowserDevicePreset {
  try {
    const value = sessionStorage.getItem(DEVICE_STORAGE_KEY);
    if (value === 'desktop' || value === 'tablet' || value === 'phone') return value;
  } catch { /* 存储不可用时仅使用当前面板状态。 */ }
  return 'desktop';
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function useBrowserDockController() {
  const [status, setStatus] = useState<ZhuyeBrowserStatus | null>(null);
  /** 当前帧 data URL(`data:image/jpeg;base64,...`;无帧为 null)。 */
  const [frame, setFrame] = useState<string | null>(null);
  /** 启停/导航/设备切换进行中。 */
  const [busy, setBusy] = useState(true);
  /** 动作失败信息(状态查询失败也进这里 —— dock 每次动作都会重试)。 */
  const [error, setError] = useState<string | null>(null);
  /** 当前设备档位(本地状态;后端只在运行中应用 metrics)。 */
  const [device, setDevice] = useState<BrowserDevicePreset>(loadDevice);
  /** 地址栏草稿。 */
  const [urlDraft, setUrlDraft] = useState('');
  // 帧订阅是异步 promise:卸载早于 resolve 时也要能 unlisten(同面板页惯例)。
  const unlistenRef = useRef<(() => void) | null>(null);
  const listenerReady = useRef<Promise<void>>(Promise.resolve());
  const inputQueue = useRef<Promise<void>>(Promise.resolve());

  // 面板需要帧流；外部浏览器运行但未附加时仍显示启动入口。
  const running = status?.streaming ?? false;

  // 地址栏草稿跟随真实 URL:URL 变化才覆写。
  useEffect(() => {
    setUrlDraft(status?.url ?? '');
  }, [status?.url]);

  // 先建立订阅再查询，重进已运行的面板时由幂等 start 重放最近帧。
  useEffect(() => {
    let cancelled = false;
    const ready = listen_browser_frame((payload) => {
      if (!cancelled) setFrame(`data:image/jpeg;base64,${payload.data}`);
    }).then((un) => {
      if (cancelled) un();
      else unlistenRef.current = un;
    });
    listenerReady.current = ready;
    void ready.then(async () => {
      if (cancelled) return;
      const next = await zhuye_browser_status();
      if (cancelled) return;
      setStatus(next);
      setError(null);
      if (next?.streaming) {
        const replayed = await zhuye_browser_start();
        if (!cancelled && replayed) {
          setStatus(replayed);
          if (replayed.streaming) {
            const { width, height } = BROWSER_DEVICE_PRESETS[device];
            const adjusted = await zhuye_browser_set_device(width, height);
            if (!cancelled && adjusted) setStatus(adjusted);
          }
        }
      }
    }).catch((cause) => { if (!cancelled) setError(messageOf(cause)); })
      .finally(() => { if (!cancelled) setBusy(false); });
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
    void run(async () => {
      await listenerReady.current;
      const started = await zhuye_browser_start();
      // 启动成功后即使尺寸设置失败也保留停止与重试入口。
      setStatus(started);
      const { width, height } = BROWSER_DEVICE_PRESETS[device];
      return (await zhuye_browser_set_device(width, height)) ?? started;
    });
  }, [device, run]);

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
      const savePreset = () => {
        setDevice(preset);
        try { sessionStorage.setItem(DEVICE_STORAGE_KEY, preset); } catch { /* 内存态仍可用。 */ }
      };
      if (!running) { savePreset(); return; }
      void run(async () => {
        await inputQueue.current;
        const next = await zhuye_browser_set_device(metrics.width, metrics.height);
        savePreset();
        return next;
      });
    },
    [run, running],
  );

  /**
   * 注入一次输入事件到受控页面。
   *
   * 失败（浏览器未启动 / 会话已结束）进 error 态，面板可重试；
   * 不打断帧流 —— 画面继续出。
   */
  const sendInput = useCallback((event: ZhuyeBrowserInputEvent) => {
    if (busy || !running) return;
    // 按事件顺序送达，避免快速点击或按键时 mouseUp/keyUp 抢先执行。
    inputQueue.current = inputQueue.current
      .then(() => zhuye_browser_input(event))
      .then(() => setError(null))
      .catch((cause) => setError(messageOf(cause)));
  }, [busy, running]);

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
    sendInput,
  };
}
