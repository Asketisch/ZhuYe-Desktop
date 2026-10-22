/**
 * 浏览器态 setup shim —— fakeBackend 的 `import ... from '@/test/setup'`
 * 在视觉回归构建(vite alias)下指到本文件;vitest 环境下仍指真正的
 * `src/test/setup.tsx`。两边导出同形:mockInvoke / resetMockInvoke /
 * emitMockEvent / resetMockEvents。
 *
 * 实现 re-export 自 tauriCore.ts(同一份注册表同时服务
 * `@tauri-apps/api/*` 的 alias 与 fakeBackend 的 `@/test/setup` alias)。
 */
export { mockInvoke, resetMockInvoke, emitMockEvent, resetMockEvents } from './tauriCore';
