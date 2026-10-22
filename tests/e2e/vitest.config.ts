import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * e2e 层专用 vitest 配置 —— **不**带 `src/test/setup.tsx`(那是 vitest
 * mock 环境的;e2e 的窗口冒烟用 selenium-webdriver 客户端,视觉回归用
 * playwright-core 直连,都不需要 Tauri mock)。
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    setupFiles: [],
    testTimeout: 90_000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../../src', import.meta.url)),
    },
  },
});
