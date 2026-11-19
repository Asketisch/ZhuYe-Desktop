/**
 * 受控浏览器面板命令封装。
 *
 * agent 对浏览器的**控制**(点击/输入/截屏)走上游 `zhuye-browser`
 * 插件的 MCP 工具;本命令面管**桌面面板的显示通道**——screencast
 * 帧流(`reflect_browser_frame` 事件)的启停、状态查询与地址栏导航
 * (后端开短连接 page 级 CDP 命令,不与帧流连接互抢)。两条通道共享
 * 同一发现契约(隔离 profile 的 DevToolsActivePort 文件)。
 *
 * DTO 为 camelCase(桌面端出线约定)。
 */
import { invoke, listen } from '../bridge';

/** 浏览器面板状态(后端 `BrowserStatusDto`)。 */
export interface ReflectBrowserStatus {
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
export interface ReflectBrowserEnv {
  /** 是否设置了 ZHUYE_BROWSER_EXECUTABLE 覆盖。 */
  executableOverride: boolean;
  /** 隔离 profile 目录(诊断用)。 */
  profileDir: string;
}

/** `reflect_browser_frame` 事件负载(base64 JPEG 帧)。 */
export interface ReflectBrowserFrame {
  data: string;
}

/** 启动浏览器(必要时)并开始帧流;重复调用幂等。 */
export async function reflect_browser_start(): Promise<ReflectBrowserStatus> {
  return invoke<ReflectBrowserStatus>('reflect_browser_start');
}

/** 停止帧流;本应用拉起的实例一并回收,外部实例保留。 */
export async function reflect_browser_stop(): Promise<ReflectBrowserStatus> {
  return invoke<ReflectBrowserStatus>('reflect_browser_stop');
}

/** 查询状态(**无副作用**:不启动浏览器)。 */
export async function reflect_browser_status(): Promise<ReflectBrowserStatus> {
  return invoke<ReflectBrowserStatus>('reflect_browser_status');
}

/** 诊断:profile 目录与可执行文件覆盖状态。 */
export async function reflect_browser_env(): Promise<ReflectBrowserEnv> {
  return invoke<ReflectBrowserEnv>('reflect_browser_env');
}

/** 地址栏导航(输入规范化:无 scheme 补 `https://`);导航后返回状态。 */
export async function reflect_browser_navigate(url: string): Promise<ReflectBrowserStatus> {
  return invoke<ReflectBrowserStatus>('reflect_browser_navigate', { url });
}

/** 后退一步(导航历史越界时后端 no-op);返回状态。 */
export async function reflect_browser_back(): Promise<ReflectBrowserStatus> {
  return invoke<ReflectBrowserStatus>('reflect_browser_back');
}

/** 前进一步(导航历史越界时后端 no-op);返回状态。 */
export async function reflect_browser_forward(): Promise<ReflectBrowserStatus> {
  return invoke<ReflectBrowserStatus>('reflect_browser_forward');
}

/** 刷新当前页;返回状态。 */
export async function reflect_browser_reload(): Promise<ReflectBrowserStatus> {
  return invoke<ReflectBrowserStatus>('reflect_browser_reload');
}

/** 应用设备模拟尺寸(0/0 = 清除 override 复位);返回状态。 */
export async function reflect_browser_set_device(
  width: number,
  height: number,
): Promise<ReflectBrowserStatus> {
  return invoke<ReflectBrowserStatus>('reflect_browser_set_device', { width, height });
}

/** 订阅 screencast 帧(base64 JPEG);返回取消订阅函数。 */
export function listen_browser_frame(
  handler: (payload: ReflectBrowserFrame) => void,
): Promise<() => void> {
  return listen<ReflectBrowserFrame>('reflect_browser_frame', (e) => handler(e.payload));
}
