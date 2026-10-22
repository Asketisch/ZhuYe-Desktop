/**
 * 视觉回归用 Tauri core shim —— 以 **浏览器模式** 运行真实前端时,
 * 把 `@tauri-apps/api/core` 的 `invoke` 转接到 fakeBackend。
 *
 * 由 `vite.config.visual.ts` 以 resolve.alias 注入,仅视觉回归构建使用,
 * 不进入任何生产/常规测试路径。
 *
 * fakeBackend 把 handler 注册进 `src/test/setup.tsx` 的 `mockInvoke`
 * 注册表 —— 浏览器里没有 vitest,所以这里**复刻同一份注册表语义**:
 * alias 模块在首次调用前安装 fakeBackend(它经 `mockInvoke` 写注册表),
 * 之后 invoke 按表派发;listen 收集 `reflect_event` 订阅者,供
 * `emitMockEvent` 同形派发(Playwright 场景经 `window.__reflectEmitEvent`
 * 注入 agent 事件,与 vitest 的 `emitEvent` 完全同构)。
 */
import { installFakeBackend, type FakeBackend } from '../../helpers/fakeBackend';

// ① 复刻 setup.tsx 的 handler 注册表(浏览器态)。
type InvokeHandler = (...args: unknown[]) => Promise<unknown>;
const invokeHandlers = new Map<string, InvokeHandler>();

export function mockInvoke(cmd: string, handler: InvokeHandler): void {
  invokeHandlers.set(cmd, handler);
}

export function resetMockInvoke(): void {
  invokeHandlers.clear();
}

// ② 事件注册表 + 同形派发(供 spec 注入协议事件)。
type EventHandler = (e: { payload: unknown }) => void;
const eventHandlers = new Map<string, Set<EventHandler>>();

export function emitMockEvent(event: string, payload: unknown): void {
  const handlers = eventHandlers.get(event);
  if (handlers) for (const fn of handlers) fn({ payload });
}

export function resetMockEvents(): void {
  eventHandlers.clear();
}

// ③ 安装:fakeBackend 在 import 时把全部命令 handler 写进上面的注册表。
let backend: FakeBackend | null = null;

function ensureBackend(): FakeBackend {
  if (!backend) {
    // fakeBackend 的 `import { mockInvoke, resetMockInvoke, emitMockEvent }`
    // 来自 '@/test/setup' —— 浏览器构建下该 re-export 被
    // `vite.config.visual.ts` 的 alias 指到本文件,闭环成立。
    backend = installFakeBackend();
  }
  return backend;
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  ensureBackend();
  const handler = invokeHandlers.get(cmd);
  if (!handler) throw new Error(`[visual] invoke('${cmd}') not mocked`);
  return handler(cmd, args) as Promise<T>;
}

export async function listen<T>(
  event: string,
  handler: (e: { payload: T }) => void,
): Promise<() => void> {
  if (!eventHandlers.has(event)) eventHandlers.set(event, new Set());
  eventHandlers.get(event)!.add(handler as EventHandler);
  return () => {
    eventHandlers.get(event)?.delete(handler as EventHandler);
  };
}

// ④ Playwright 场景挂钩 —— spec 经 page.evaluate 驱动事件与状态。
declare global {
  interface Window {
    __reflectEmitEvent?: (id: string, msg: unknown) => void;
    __reflectBackend?: () => unknown;
  }
}

export function mountVisualGlobals(): void {
  const b = ensureBackend();
  window.__reflectEmitEvent = (id: string, msg: unknown) => {
    emitMockEvent('reflect_event', { id, msg });
  };
  window.__reflectBackend = () => b;
}
