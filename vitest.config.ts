import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { configDefaults } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.tsx'],
    include: [
      'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      'tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
    ],
    // L5 的 WebDriver 冒烟与视觉回归由各自 vitest.config.ts 单独跑
    // (e2e:node 环境 + selenium-webdriver 仅 Linux 真窗口路径;visual:
    // 依赖 dist-visual 构建 + 无头 Chromium),不进默认全量。
    exclude: [
      'tests/e2e/**',
      'tests/visual/**',
      ...configDefaults.exclude,
    ],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
