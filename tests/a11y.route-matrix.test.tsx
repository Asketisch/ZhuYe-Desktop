/**
 * 全路由 axe 可访问性审计 —— 与 `views.route-matrix.test.tsx` 共享同一份
 * 路由表（`helpers/routeMatrix.ts`），34 条路由逐一挂载真实应用后跑
 * axe-core。
 *
 * 断言口径:**serious / critical** 级违规为零。jsdom 没有布局引擎,
 * `color-contrast` 之类依赖真实渲染的规则关闭;这里抓的是结构性问题:
 * 无名按钮 / 无 label 输入 / 缺 landmark / 标题层级跳跃 / ARIA 误用。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { renderApp, resetAppAfterEach } from './helpers/appHarness';
import { installFakeBackend } from './helpers/fakeBackend';
import { ROUTES } from './helpers/routeMatrix';

beforeEach(() => {
  installFakeBackend();
});

afterEach(async () => {
  await resetAppAfterEach();
});

describe.each(ROUTES)('route $route (a11y)', ({ route }) => {
  it('has no serious/critical axe violations', async () => {
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

    const results = await axe(document.body, {
      rules: {
        // jsdom 无布局/样式计算,颜色对比度无法在单测层评估(留给视觉回归层)。
        'color-contrast': { enabled: false },
      },
    });
    const blocking = results.violations.filter((v) =>
      (v.impact ?? 'minor') === 'serious' || (v.impact ?? 'minor') === 'critical',
    );
    const summary = blocking
      .map(
        (v) =>
          `${v.id}(${v.impact}): ${v.nodes
            .slice(0, 3)
            .map((n) => n.target.join(' '))
            .join(' | ')}`,
      )
      .join('; ');
    if (blocking.length > 0) {
      throw new Error(`route ${route} 存在 ${blocking.length} 类 serious/critical 级 a11y 违规:${summary}`);
    }
  }, 40_000);
});
