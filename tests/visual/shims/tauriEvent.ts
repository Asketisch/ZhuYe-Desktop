/**
 * 视觉回归用 Tauri event shim —— 与 `tauriCore.ts` 配对。
 *
 * `@tauri-apps/api/event` 的 `listen` 被转到同一份事件注册表;
 * spec 经 `window.__reflectEmitEvent(id, msg)` 注入协议事件,
 * 与 vitest 路径的 `emitEvent` 完全同构。
 */
import { listen } from './tauriCore';

export { listen };
export type UnlistenFn = () => void;
