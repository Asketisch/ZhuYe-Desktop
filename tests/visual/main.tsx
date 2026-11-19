/**
 * 浏览器入口 —— 仅视觉回归构建使用(vite.config.visual.ts 的 build.rollupOptions
 * input 指到这里)。与 `src/main.tsx` 唯一的差异:挂 fakeBackend 全局挂钩,
 * 供 Playwright spec 注入协议事件 / 读取后端状态。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { AppProviders, router } from '../../src/router';
import { RendererProvider } from '../../src/logic/renderer/RendererProvider';
import { renderer } from '../../src/render';
import { bootstrapAppearance } from '../../src/logic/webview/bootstrapAppearance';
import { mountVisualGlobals } from './shims/tauriCore';
import '../../src/render/styles/tokens.css';
import '../../src/render/styles/base.css';

bootstrapAppearance(renderer.appearance);
mountVisualGlobals();

const root = document.getElementById('root');
if (!root) {
  throw new Error('#root element missing');
}

createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <RendererProvider renderer={renderer}>
        <RouterProvider router={router} />
      </RendererProvider>
    </AppProviders>
  </StrictMode>,
);
