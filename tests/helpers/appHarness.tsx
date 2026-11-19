/**
 * appHarness —— 应用级测试挂载工具。
 *
 * 提供两种模式：
 *   1. `renderApp()`   —— 全量真实应用：AppProviders + RouterProvider + 真实路由表
 *      （等价 `main.tsx` 的组合根），测试通过 `navigate()` 走真实路由跳转。
 *   2. `renderView()`  —— 局部视图 + 全新 QueryClient/I18nProvider，
 *      用于需要完全隔离 query 缓存的领域套件。
 *
 * 两者都挂真实 I18nProvider（默认 en locale），组件读到的文案与生产一致。
 */
import { render, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { AppProviders, router } from '@/router';
import { bootstrapAppearance } from '@/logic/webview/bootstrapAppearance';
import { RendererProvider } from '@/logic/renderer/RendererProvider';
import { renderer as defaultRenderer } from '@/render';
import type { Renderer } from '@/contracts/renderer';
import { I18nProvider } from '@/utils/i18n';
import { useAgentStore } from '@/stores/agentStore';

export interface RenderAppResult {
  /** 导航到目标路由（等待路由器 commit）。 */
  navigate: (to: string) => Promise<void>;
  /** 当前路由 pathname。 */
  pathname: () => string;
}

let stopAppearance: (() => void) | undefined;

/**
 * 挂载完整应用。必须在 installFakeBackend() 之后调用。
 *
 * 与生产 `AppProviders` 的差异：每次挂载使用**全新 QueryClient**
 * （避免同文件多测试共享缓存读到陈旧列表），使用生产 `AppProviders` 的事件订阅。
 */
export function renderApp(renderer: Renderer = defaultRenderer): RenderAppResult {
  // 每次挂载前重置 agent store，避免跨测试状态泄漏。
  useAgentStore.getState().reset();
  stopAppearance?.();
  stopAppearance = bootstrapAppearance(renderer.appearance);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  render(
    <AppProviders queryClient={queryClient}>
      <RendererProvider renderer={renderer}>
        <RouterProvider router={router} />
      </RendererProvider>
    </AppProviders>,
  );

  return {
    navigate: async (to: string) => {
      await act(async () => {
        await router.navigate({ to });
      });
    },
    pathname: () => router.state.location.pathname,
  };
}

/** 挂载局部视图（全新 QueryClient，retry 关闭）。 */
export function renderView(ui: ReactNode): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <I18nProvider>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </I18nProvider>,
  );
}

/** 每个套件 afterEach 的通用清理：重置 store + 回到根路由。 */
export async function resetAppAfterEach(): Promise<void> {
  stopAppearance?.();
  stopAppearance = undefined;
  useAgentStore.getState().reset();
  if (router.state.location.pathname !== '/') {
    await act(async () => {
      await router.navigate({ to: '/' });
    });
  }
}
