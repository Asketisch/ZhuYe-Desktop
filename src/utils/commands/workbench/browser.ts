/**
 * 受控浏览器面板命令封装。
 *
 * agent 对浏览器的**控制**(点击/输入/截屏)走上游 `zhuye-browser`
 * 插件的 MCP 工具;本命令面管**桌面面板的显示通道**——screencast
 * 帧流(`zhuye_browser_frame` 事件)的启停、状态查询与地址栏导航
 * (后端开短连接 page 级 CDP 命令,不与帧流连接互抢)。两条通道共享
 * 同一发现契约(隔离 profile 的 DevToolsActivePort 文件)。
 *
 * DTO 为 camelCase(桌面端出线约定)。
 */
import { invoke, listen } from '../../bridge';

/** 浏览器面板状态(后端 `BrowserStatusDto`)。 */
export interface ZhuyeBrowserStatus {
  /** 浏览器是否在运行(有可连的 CDP 实例)。 */
  running: boolean;
  /** 受控页面 URL(未知时为 null)。 */
  url: string | null;
  /** 页面标题(未知时为 null)。 */
  title: string | null;
  /** 面板帧流是否已启动。 */
  streaming: boolean;
  /** 附加说明(attach 外部实例 / 处置方式等)。 */
  message: string | null;
}

/** 浏览器诊断信息(后端 `BrowserEnvInfo`)。 */
export interface ZhuyeBrowserEnv {
  /** 是否设置了 ZHUYE_BROWSER_EXECUTABLE 覆盖。 */
  executableOverride: boolean;
  /** 隔离 profile 目录(诊断用)。 */
  profileDir: string;
}

/** `zhuye_browser_frame` 事件负载(base64 JPEG 帧)。 */
export interface ZhuyeBrowserFrame {
  data: string;
}

/**
 * 面板输入事件（与后端 `BrowserInputEvent` 同构）。
 *
 * `x` / `y` 是**归一化坐标**（0..1，相对面板里渲染出来的画面）——
 * 后端按页面 CSS 视口换算成页面坐标，故面板缩放不影响落点。
 */
export type ZhuyeBrowserInputEvent =
  | { type: 'mouseMove'; x: number; y: number; modifiers: number }
  | {
      type: 'mouseDown' | 'mouseUp';
      x: number;
      y: number;
      button: string;
      clickCount: number;
      modifiers: number;
    }
  | {
      type: 'mouseWheel';
      x: number;
      y: number;
      deltaX: number;
      deltaY: number;
      modifiers: number;
    }
  | {
      type: 'key';
      action: 'down' | 'up';
      key: string;
      code: string;
      text?: string;
      virtualKeyCode?: number;
      modifiers: number;
    };

/** CDP 修饰键位掩码：Alt=1 / Ctrl=2 / Meta=4 / Shift=8。 */
export const BROWSER_MODIFIER_ALT = 1;
export const BROWSER_MODIFIER_CTRL = 2;
export const BROWSER_MODIFIER_META = 4;
export const BROWSER_MODIFIER_SHIFT = 8;

/** 由 DOM 键盘/鼠标事件的修饰键布尔量合成 CDP 位掩码。 */
export function browserModifiersFrom(
  flags: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean },
): number {
  let mask = 0;
  if (flags.altKey) mask |= BROWSER_MODIFIER_ALT;
  if (flags.ctrlKey) mask |= BROWSER_MODIFIER_CTRL;
  if (flags.metaKey) mask |= BROWSER_MODIFIER_META;
  if (flags.shiftKey) mask |= BROWSER_MODIFIER_SHIFT;
  return mask;
}

/** 注入一次输入事件到受控页面（未启动浏览器时后端返回结构化错误）。 */
export async function zhuye_browser_input(event: ZhuyeBrowserInputEvent): Promise<void> {
  return invoke<void>('zhuye_browser_input', { event });
}

/** 启动浏览器并等待帧流确认；已在流时重放最近一帧。 */
export async function zhuye_browser_start(): Promise<ZhuyeBrowserStatus> {
  return invoke<ZhuyeBrowserStatus>('zhuye_browser_start');
}

/** 停止帧流;本应用拉起的实例一并回收,外部实例保留。 */
export async function zhuye_browser_stop(): Promise<ZhuyeBrowserStatus> {
  return invoke<ZhuyeBrowserStatus>('zhuye_browser_stop');
}

/** 查询状态(**无副作用**:不启动浏览器)。 */
export async function zhuye_browser_status(): Promise<ZhuyeBrowserStatus> {
  return invoke<ZhuyeBrowserStatus>('zhuye_browser_status');
}

/** 诊断:profile 目录与可执行文件覆盖状态。 */
export async function zhuye_browser_env(): Promise<ZhuyeBrowserEnv> {
  return invoke<ZhuyeBrowserEnv>('zhuye_browser_env');
}

/** 地址栏导航(输入规范化:无 scheme 补 `https://`);导航后返回状态。 */
export async function zhuye_browser_navigate(url: string): Promise<ZhuyeBrowserStatus> {
  return invoke<ZhuyeBrowserStatus>('zhuye_browser_navigate', { url });
}

/** 后退一步(导航历史越界时后端 no-op);返回状态。 */
export async function zhuye_browser_back(): Promise<ZhuyeBrowserStatus> {
  return invoke<ZhuyeBrowserStatus>('zhuye_browser_back');
}

/** 前进一步(导航历史越界时后端 no-op);返回状态。 */
export async function zhuye_browser_forward(): Promise<ZhuyeBrowserStatus> {
  return invoke<ZhuyeBrowserStatus>('zhuye_browser_forward');
}

/** 刷新当前页;返回状态。 */
export async function zhuye_browser_reload(): Promise<ZhuyeBrowserStatus> {
  return invoke<ZhuyeBrowserStatus>('zhuye_browser_reload');
}

/** 应用设备模拟尺寸(0/0 = 清除 override 复位);返回状态。 */
export async function zhuye_browser_set_device(
  width: number,
  height: number,
): Promise<ZhuyeBrowserStatus> {
  return invoke<ZhuyeBrowserStatus>('zhuye_browser_set_device', { width, height });
}

/** 订阅 screencast 帧(base64 JPEG);返回取消订阅函数。 */
export function listen_browser_frame(
  handler: (payload: ZhuyeBrowserFrame) => void,
): Promise<() => void> {
  return listen<ZhuyeBrowserFrame>('zhuye_browser_frame', (e) => handler(e.payload));
}
