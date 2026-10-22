/**
 * 视觉回归专用 Vite 配置 —— 与根 `vite.config.ts` 的差异只有三处:
 *   1. 入口是 `tests/visual/index.html`(→ `tests/visual/main.tsx`),
 *      挂 fakeBackend 全局挂钩;
 *   2. `@tauri-apps/api/core` / `event` / `@/test/setup` 三个模块被 alias
 *      到 `tests/visual/shims/` —— 浏览器态下 fakeBackend 全命令接管;
 *   3. 产物落在 `dist-visual/`,不污染发布产物 `dist/`。
 *
 * 消费方:`tests/e2e/run.sh` 的视觉回归用例(Playwright 静态服务此目录)。
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// 视觉构建的「仓库根」虚拟上移一层:input 以 `/tests/visual/index.html`
// 引用,产物 index.html 拍平到 outDir 顶(静态服务与 SPA 回退都以它为根)。
export default defineConfig({
  plugins: [react()],
  root: r('./tests/visual'),
  resolve: {
    alias: [
      // 顺序敏感:字符串 find 是**前缀匹配**,精确条目必须放在 "@" 之前,
      // 否则 @/test/setup 被 "@" → src 吞掉,真 setup.tsx(vitest 依赖)
      // 进浏览器 bundle 顶层 vi.mock 抛错 → 白屏。
      { find: /^@\/test\/setup$/, replacement: r('./tests/visual/shims/testSetup.ts') },
      { find: /^@tauri-apps\/api\/core$/, replacement: r('./tests/visual/shims/tauriCore.ts') },
      { find: /^@tauri-apps\/api\/event$/, replacement: r('./tests/visual/shims/tauriEvent.ts') },
      { find: '@', replacement: r('./src') },
    ],
  },
  clearScreen: false,
  build: {
    outDir: r('./dist-visual'),
    emptyOutDir: true,
    target: 'esnext',
  },
});
