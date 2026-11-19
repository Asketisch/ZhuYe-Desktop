import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { AppProviders, router } from './router';
import { RendererProvider } from './logic/renderer/RendererProvider';
import { renderer } from './render';
import { bootstrapAppearance } from './logic/webview/bootstrapAppearance';
import './render/styles/tokens.css';
import './render/styles/base.css';

// 启动时把持久化的主题模式 + UI 偏好 apply 到 <html>。
bootstrapAppearance(renderer.appearance);

// 桌面壳层：拦截 WebView 默认右键菜单（macOS WKWebView 会带 Reload 等
// 浏览器项，对桌面应用无意义且可打断会话）。文本编辑走应用菜单的
// Edit 项与 Cmd+C/V 快捷键。
document.addEventListener('contextmenu', (e) => e.preventDefault());

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
  </StrictMode>
);
