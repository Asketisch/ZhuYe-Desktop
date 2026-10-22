import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * 视觉回归专用 vitest 配置 —— 环境是 node(Playwright 自己管理浏览器,
 * 不需要 jsdom);spec 的静态服务/基线比对全部自包含。
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/visual/**/*.spec.ts'],
    setupFiles: [],
    testTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../../src', import.meta.url)),
    },
  },
});
