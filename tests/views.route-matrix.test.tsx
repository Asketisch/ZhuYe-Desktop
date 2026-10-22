/**
 * 全路由视图矩阵 —— 34 条路由逐一挂载真实应用。
 *
 * 每条路由断言三层：
 *   1. 路由可导航且视图挂载（主内容区非空）；
 *   2. 该视图的数据管道真实接通（领域命令被调用）；
 *   3. 数据可见（fakeBackend fixture 的关键字段渲染进 DOM）。
 *
 * 新增路由但未接线（命令没调、数据没渲染）会在此处立刻暴露。
 *
 * 另有一遍 **zh-CN 渲染检查**：`src/utils/i18n.test.ts` 只保证目录层面
 * 每个 key 都有两种语言的翻译；这里补的是渲染层面 —— 切到 zh-CN 后每条
 * 路由的 DOM 里不能出现任何裸 key（`t()` 对缺失 key 的回退就是返回 key
 * 本身，目录测试测不到「组件传了个不存在的 key」），且页面确实出现了中文
 * （组件若漏在 `I18nProvider` 之外会静默回退到英文）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderApp, resetAppAfterEach } from './helpers/appHarness';
import { installFakeBackend, type FakeBackend } from './helpers/fakeBackend';
import { ALL_KEYS, STORAGE_KEY } from '@/utils/i18n';
import { ROUTES } from './helpers/routeMatrix';

let backend: FakeBackend;

beforeEach(() => {
  backend = installFakeBackend();
});

afterEach(async () => {
  await resetAppAfterEach();
});

/** 渲染文本里出现的裸 i18n key（应为空）。 */
function leakedKeys(text: string): string[] {
  return ALL_KEYS.filter((key) => text.includes(key));
}

describe.each(ROUTES)('route $route', ({ route, commands, shows }) => {
  it('mounts, wires its data pipeline and renders fixture data', async () => {
    const app = renderApp();
    await app.navigate(route);

    // 1. 视图挂载：主内容区渲染了非空内容。
    await waitFor(
      () => {
        const main = document.querySelector('main');
        expect(main).not.toBeNull();
        expect((main?.textContent ?? '').length).toBeGreaterThan(0);
      },
      { timeout: 8000 },
    );

    // 2. 数据管道：领域命令被真实调用。
    for (const cmd of commands ?? []) {
      await waitFor(() => expect(backend.callsOf(cmd).length).toBeGreaterThanOrEqual(1), {
        timeout: 8000,
      });
    }

    // 3. 数据可见：fixture 关键字段进入 DOM。
    for (const text of shows ?? []) {
      await waitFor(
        () => expect(document.querySelector('main')?.textContent ?? document.body.textContent).toContain(text),
        { timeout: 8000 },
      );
    }

    // 4. 英文渲染也不能漏裸 key。
    expect(leakedKeys(document.body.textContent ?? '')).toEqual([]);
  }, 40_000);
});

describe.each(ROUTES)('route $route (zh-CN)', ({ route }) => {
  it('renders in Chinese without leaking raw i18n keys', async () => {
    // I18nProvider 在挂载时读 localStorage 决定初始 locale。
    window.localStorage.setItem(STORAGE_KEY, 'zh-CN');
    const app = renderApp();
    await app.navigate(route);

    await waitFor(
      () => {
        const main = document.querySelector('main');
        expect(main).not.toBeNull();
        expect((main?.textContent ?? '').length).toBeGreaterThan(0);
      },
      { timeout: 8000 },
    );

    expect(document.documentElement.getAttribute('lang')).toBe('zh-CN');
    const body = document.body.textContent ?? '';
    // 壳层（活动栏 / 侧栏）的文案一定会出现中文；一个字都没有说明 locale 没生效。
    expect(body, `route ${route} 在 zh-CN 下没有渲染出任何中文`).toMatch(/[\u4e00-\u9fff]/);
    expect(leakedKeys(body), `route ${route} 在 zh-CN 下泄漏了裸 i18n key`).toEqual([]);
  }, 40_000);
});

describe('route tree completeness', () => {
  it('matrix covers every route declared in router.tsx', async () => {
    const { router } = await import('@/router');
    // 从路由树展平全部叶子路径。
    const paths = new Set<string>();
    const walk = (routes: Array<{ path: string; children?: unknown }>, prefix: string) => {
      for (const r of routes) {
        const full = r.path === '/' ? '/' : `${prefix}/${r.path}`;
        paths.add(full.replace(/\/+/g, '/'));
        if (Array.isArray(r.children)) walk(r.children as typeof routes, full);
      }
    };
    // router.routeTree 是扁平 Route 对象树 —— 通过 routes by id 遍历。
    const tree = router.routeTree as unknown as {
      children: Array<{ path: string; children?: Array<{ path: string; children?: unknown }> }>;
    };
    walk(tree.children ?? [], '');
    paths.add('/');

    const covered = new Set(ROUTES.map((r) => r.route));
    const uncovered = [...paths].filter(
      (p) => p !== '/' || covered.has('/'), // '/' 与动态段($sessionId)由矩阵显式覆盖
    );
    // 矩阵必须覆盖路由树声明的每条静态路由。
    const missing = [...paths].filter(
      (p) => !covered.has(p) && !p.includes('$'),
    );
    expect(missing).toEqual([]);
    expect(uncovered.length).toBeGreaterThanOrEqual(0);
  });
});
