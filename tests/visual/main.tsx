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
// harness.css 必须一起进视觉构建 —— 少了它,基线拍到的是**没有任何壳层
// 布局样式**的页面(v3 harness 换装后基线全部失真,视觉门禁形同虚设)。
// 守卫见 tests/visual/visual.spec.ts 的「视觉构建必须引入 harness.css」。
import '../../src/render/styles/harness.css';

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
