/**
 * 视图渲染错误边界 —— 「一个视图崩了 ≠ 整个应用白屏」。
 *
 * 此前 `src/` 没有任何 ErrorBoundary:任一视图 render 抛错会卸掉整棵
 * React 树(白屏,只能重启)。`AppShell` 现在把 `<Outlet />` 包在
 * `ViewErrorBoundary` 里 —— 这里用**真实视图**的崩溃路径(KMS 页面
 * 列表对 `tags: null` 的 `page.tags.map` 无守卫)锁定三件事:
 *   1. 抛错视图显示回退(错误信息 + Retry),侧栏/状态栏仍可用;
 *   2. 故障清除后点 Retry,视图恢复;
 *   3. 切走再切回,不残留错误态。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderApp, resetAppAfterEach } from './helpers/appHarness';
import { installFakeBackend, type FakeBackend } from './helpers/fakeBackend';

let backend: FakeBackend;

beforeEach(() => {
  backend = installFakeBackend();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await resetAppAfterEach();
});

/** 让 KMS 页面列表带 `tags: null` —— KmsView 的 `page.tags.map` 会在 render 抛错。 */
function breakKmsPageList() {
  backend.override('reflect_kms_list_pages', () =>
    JSON.parse(
      JSON.stringify([
        { name: 'broken.md', wiki: 'engineering', content: 'probe', title: null, tags: null, modified_at_ms: 0 },
      ]),
    ),
  );
}

describe('view error boundary', () => {
  it('a crashing view shows the fallback while the shell stays alive', async () => {
    breakKmsPageList();
    const app = renderApp();
    await app.navigate('/kms');

    // 选中 wiki 触发页面列表渲染 → render 崩溃 → 边界兜住。
    fireEvent.click(await screen.findByText('engineering'));
    const fallback = await screen.findByTestId('view-error-boundary');
    expect(fallback.textContent).toMatch(/tags|map|null/i);

    // 壳层仍然活着:状态栏与主内容区结构还在(崩溃被限制在视图内)。
    expect(document.querySelector('[data-testid="statusbar-session-count"]')).not.toBeNull();
    expect(document.querySelector('main')).not.toBeNull();
  }, 20_000);

  it('Retry remounts the view and it recovers once the failure is gone', async () => {
    breakKmsPageList();
    const app = renderApp();
    await app.navigate('/kms');
    fireEvent.click(await screen.findByText('engineering'));
    await screen.findByTestId('view-error-boundary');

    // 故障清除后点 Retry —— 视图恢复(回退消失)。
    backend.override('reflect_kms_list_pages', () =>
      JSON.parse(
        JSON.stringify([
          { name: 'auth.md', wiki: 'engineering', content: '# Auth\nJWT flow', title: 'Auth', tags: ['auth'], modified_at_ms: 0 },
        ]),
      ),
    );
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(
      () => {
        expect(screen.queryByTestId('view-error-boundary')).toBeNull();
      },
      { timeout: 8000 },
    );
  }, 20_000);

  it('navigating away and back starts clean', async () => {
    breakKmsPageList();
    const app = renderApp();
    await app.navigate('/kms');
    fireEvent.click(await screen.findByText('engineering'));
    await screen.findByTestId('view-error-boundary');

    // 切走(健康视图):边界立即消失 —— 崩溃不外溢到其它路由。
    await app.navigate('/home');
    await waitFor(() => {
      expect(screen.queryByTestId('view-error-boundary')).toBeNull();
    });
    // 故障清除后切回:干净渲染,不再出现边界(测试 QueryClient 的 gcTime=0,
    // 切走时坏缓存已被回收;生产缓存窗口内的致崩由上一条 Retry 用例覆盖)。
    backend.override('reflect_kms_list_pages', () =>
      JSON.parse(JSON.stringify([{ name: 'auth.md', wiki: 'engineering', content: 'ok', title: null, tags: [], modified_at_ms: 0 }])),
    );
    await app.navigate('/kms');
    fireEvent.click(await screen.findByText('engineering'));
    await waitFor(
      () => {
        expect(screen.queryByTestId('view-error-boundary')).toBeNull();
      },
      { timeout: 8000 },
    );
  }, 20_000);
});
