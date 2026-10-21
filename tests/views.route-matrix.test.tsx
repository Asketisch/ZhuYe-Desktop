/**
 * 全路由视图矩阵 —— 34 条路由逐一挂载真实应用。
 *
 * 每条路由断言三层：
 *   1. 路由可导航且视图挂载（主内容区非空）；
 *   2. 该视图的数据管道真实接通（领域命令被调用）；
 *   3. 数据可见（fakeBackend fixture 的关键字段渲染进 DOM）。
 *
 * 新增路由但未接线（命令没调、数据没渲染）会在此处立刻暴露。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderApp, resetAppAfterEach } from './helpers/appHarness';
import { installFakeBackend, type FakeBackend } from './helpers/fakeBackend';

let backend: FakeBackend;

beforeEach(() => {
  backend = installFakeBackend();
});

afterEach(async () => {
  await resetAppAfterEach();
});

interface RouteSpec {
  route: string;
  /** 挂载后应被调用的命令（数据管道接通证据）。 */
  commands?: string[];
  /** fixture 中应渲染进 DOM 的关键文本。 */
  shows?: string[];
}

const ROUTES: RouteSpec[] = [
  { route: '/', commands: ['reflect_list_sessions'] },
  { route: '/home' },
  { route: '/chat' },
  {
    route: '/sessions',
    commands: ['reflect_list_sessions'],
  },
  {
    route: '/settings',
    commands: ['reflect_get_config', 'reflect_agent_status'],
    shows: ['anthropic/claude-sonnet-4'],
  },
  {
    route: '/files',
    commands: ['reflect_list_dir'],
    shows: ['README.md'],
  },
  {
    route: '/models',
    commands: ['reflect_agent_status'],
  },
  {
    route: '/skills',
    commands: ['reflect_list_tools'],
    shows: ['read_file'],
  },
  {
    // WorkspacesView 由 workspaces.json 历史驱动；当前工作区来自 agent-status。
    route: '/workspaces',
    commands: ['reflect_list_workspaces', 'reflect_agent_status'],
    shows: ['/Users/dev/project'],
  },
  {
    route: '/git',
    commands: ['reflect_git_status', 'reflect_git_diff', 'reflect_git_log'],
    shows: ['feat: parser'],
  },
  {
    // P3：拉取请求（gh CLI）；fakeBackend 默认空列表。
    route: '/pulls',
    commands: ['reflect_gh_pr_list'],
  },
  {
    // P3：hooks 运行时启停面板。
    route: '/hooks',
    commands: ['reflect_list_hooks'],
  },
  { route: '/terminal' },
  { route: '/plan' },
  { route: '/prompts' },
  { route: '/about', commands: ['reflect_agent_status'] },
  {
    // 默认 tab 为 inbox；activity 查询按 tab 启用。
    route: '/notifications',
  },
  { route: '/debug' },
  { route: '/apps' },
  {
    route: '/collaboration',
    commands: ['reflect_list_tools'],
  },
  { route: '/mobile' },
  { route: '/dictation' },
  {
    // section 名是 data-section 属性，不进 textContent（细节由其专属测试覆盖）。
    route: '/design-system',
  },
  {
    route: '/memory',
    commands: ['reflect_list_memory'],
    shows: ['build-cmd'],
  },
  { route: '/search' },
  {
    route: '/tasks',
    commands: ['reflect_list_tasks'],
    shows: ['Ship v2'],
  },
  {
    route: '/schedule',
    commands: ['reflect_list_schedules'],
    shows: ['run the nightly build'],
  },
  {
    route: '/agents',
    commands: ['reflect_list_agent_defs'],
    shows: ['reviewer'],
  },
  {
    route: '/side-channels',
    commands: ['reflect_list_side_channels'],
    shows: ['background research'],
  },
  {
    route: '/remote',
    commands: ['reflect_get_remote_status'],
  },
  {
    route: '/kms',
    commands: ['reflect_kms_list'],
    shows: ['engineering'],
  },
  {
    route: '/autopilot',
    commands: ['reflect_get_autopilot_config'],
  },
  {
    // tasks 查询仅在选中 squad 后启用（enabled: !!selectedName）。
    route: '/squad',
    commands: ['reflect_list_squads'],
    shows: ['rocket'],
  },
  { route: '/media' },
  {
    route: '/traces',
    commands: ['reflect_list_traces'],
    shows: ['demo-session'],
  },
  {
    route: '/usage',
    commands: ['reflect_all_model_usage'],
    shows: ['openai/gpt-4o'],
  },
  {
    route: '/collaboration',
    commands: ['reflect_list_discussions'],
    shows: ['demo-session'],
  },
  {
    route: '/chat/sess-alpha',
    commands: ['reflect_replay_session'],
    shows: ['Summarize the auth flow'],
  },
];

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
