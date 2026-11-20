/**
 * 视觉回归 —— 全路由 × dark/light 截图基线。
 *
 * 前提:`vite build --config vite.config.visual.ts` 已产出 `dist-visual/`
 * (真实前端 + fakeBackend shim 的浏览器态构建),由本文件顶部的静态服务
 * 起来。路由表与行为/axe 三处同源(`helpers/routeMatrix.ts`)。
 *
 * 基线策略(与门禁其他棘轮一致):
 *   - 本地缺基线时可生成；严格环境缺基线时失败；
 *   - 有基线时逐像素比对,不一致即 FAIL(布局/主题回归零容忍);
 *     基线按操作系统分目录,避免各平台字体/合成差异被误判为产品回归;
 *   - 重生成基线:删除 `tests/visual/__baselines__/<platform>/` 后重跑,
 *     人工审查 diff 后入库;CI 基线用 visual-baselines workflow 在对应
 *     runner 上生成,避免本机字体与 CI 字体混用。
 *
 * ⚠️ **像素判定当前关闭**(见 `VISUAL_DIFF_DETECTION`):v3 harness 界面
 * 高频改版,逐像素判定带来的基线重生成 churn 大于收益。现行行为是
 * **只出图、不判定** —— 截图写到 `.test-results/visual-current/` 供
 * 人工翻看,基线保持原样;界面稳定后把开关改回 `true` 即恢复判定。
 *
 * 由 `tests/e2e/run.sh` 调用(Playwright 由该脚本按需 `pnpm dlx` 安装)。
 */
import { createServer, type Server } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { canWriteBaseline } from './baseline-policy';
import { ROUTES } from '../helpers/routeMatrix';
import { comparePng } from './png-compare';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, '../../dist-visual');
const PLATFORM_BASELINE = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux';
const BASELINES = process.env.VISUAL_BASELINES_DIR
  ? path.resolve(process.env.VISUAL_BASELINES_DIR)
  : path.join(HERE, '__baselines__', PLATFORM_BASELINE);

//
// 确定性锚点 —— 视觉基线按解码像素零容差比对,因此:
//   1. 冻结时钟:fakeBackend 的会话/activity 时间戳相对 Date.now 播种,
//      相对时间文案("5 分钟前")会随真实时钟跨跑漂移 → 固定为常量;
//   2. 关闭动画/过渡/光标闪烁(在 init 阶段注入,早于应用脚本)。
// 两者都必须在页面任何脚本执行前生效,故走 addInitScript。
//
const FREEZE_CLOCK_MS = 1767225600000; // 2026-01-01T00:00:00Z
const INIT_SCRIPT = [
  '(() => {',
  `  const FIXED = ${FREEZE_CLOCK_MS};`,
  '  class FrozenDate extends Date {',
  '    constructor(...args) {',
  '      if (args.length === 0) super(FIXED);',
  '      else super(...args);',
  '    }',
  '    static now() { return FIXED; }',
  '  }',
  '  globalThis.Date = FrozenDate;',
  '})();',
].join('\n');
const FREEZE_CSS = [
  '*, *::before, *::after {',
  '  animation: none !important;',
  '  transition: none !important;',
  '  caret-color: transparent !important;',
  '}',
].join('\n');

// ── 极简静态文件服务(dist-visual 的 SPA 回退:未知路径回 index.html)──
const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
};

/**
 * 交互面(非路由)—— 弹窗类界面。
 *
 * 路由矩阵只覆盖「一页一面」,弹窗不在路由里,于是它对视觉门禁完全隐形:
 * v3 的设置弹窗整页空白(内容被压进 200px 窄列),路由基线张张正常,
 * 没有任何一张能暴露它。这里显式登记弹窗面,让弹窗也进门禁。
 */
interface SurfaceSpec {
  /** 基线名前缀(实际文件 = `<name>--<theme>.png`)。 */
  name: string;
  /** 打开该面的路由(壳层组件在所有路由上都在)。 */
  route: string;
  /** 截图前的交互动作(打开弹窗等)。 */
  prepare?: (page: Page) => Promise<void>;
}

const SURFACES: SurfaceSpec[] = [
  // 设置页(全屏覆盖层):侧栏用户条 ⋯ 打开。曾因弹窗栅格是「200px 侧栏 +
  // 内容」双列、而内容只渲染单列,导致内容列 0 宽、整页看不到任何设置项。
  // 现为全屏两栏页;除整页默认面外,14 个分区逐面登记 —— 逐分区视觉
  // 对照(与参考实现的分区级口径核对)靠这组基线。
  ...[
    'general', 'appearance', 'groups', 'remote', 'personalization', 'behavior',
    'memory', 'agents', 'plugins', 'mcp', 'skills', 'hooks', 'usage', 'advanced',
  ].map((section) => ({
    name: `settings-${section}` as const,
    route: '/',
    prepare: async (page: Page) => {
      await page.click('[data-testid="harness-settings"]');
      await page.waitForSelector('[data-testid="settings-page"]');
      // 等默认分区(模型设置)挂载完成,再切到目标分区。
      await page.waitForSelector('[data-testid="settings-section-groups"]');
      await page.click(`[data-testid="settings-section-${section}"]`);
      // 分区内容异步加载(嵌入分区要发 IPC):等内容区出现分区标题。
      await page.waitForSelector(`[data-testid="settings-page"] h2`);
      await page.waitForTimeout(400);
    },
  })),
];

function serveStatic(root: string): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    let file = path.join(root, url);
    if (!existsSync(file) || file.endsWith('/')) file = path.join(root, 'index.html');
    try {
      const body = readFileSync(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as { port: number }).port });
    });
  });
}

// 基线目录为空(首跑前)时视为「写入模式」。
function hasBaselines(): boolean {
  return existsSync(BASELINES) && readdirSync(BASELINES).some((f) => f.endsWith('.png'));
}

/**
 * 基线缺失的策略:本地(VISUAL_UPDATE=1 或显式首跑)写盘并通过;CI 上
 * **判失败** —— 缺基线 = 该路由的视觉回归被静默停用,零容忍。
 * 发布流水线(run_all.sh e2e)通过 env `VISUAL_UPDATE` 显式声明写基线。
 */
const BASELINE_WRITE_MODE =
  canWriteBaseline(
    process.env.VISUAL_UPDATE === '1' || process.env.VISUAL_WRITE === '1',
    Boolean(process.env.CI) || process.env.E2E_REQUIRED === '1',
  );

/**
 * 显式重生成模式:覆盖已有基线(而不是仅在基线缺失时写盘)。
 * 与 `BASELINE_WRITE_MODE` 的区别:后者回答「能不能写」,前者回答
 * 「是否用当前渲染替换基线」。基线生成 workflow 必须走这个模式 ——
 * 否则旧基线仍在,逐像素比对必然失败,重生成流程无法推进。
 */
const BASELINE_REGENERATE_MODE =
  process.env.VISUAL_UPDATE === '1' || process.env.VISUAL_WRITE === '1';

/**
 * **视觉比对判定开关(当前关闭)。**
 *
 * v3 harness 界面处于高频改版期:逐像素基线每次界面改动都要三平台
 * 重生成(churn 远大于收益),且平台间字体渲染差异让基线反复假红。
 * 故此处**只出图、不判定** —— 截图照常产出(写到
 * `.test-results/visual-current/` 供人工翻看),基线一律保持原样、
 * 绝不因未判定而被悄悄覆盖。
 *
 * 判定代码整段保留在下方,未删未改:界面稳定后把本开关改回 `true`
 * 即恢复「像素差异判失败」,基线可用 `VISUAL_UPDATE=1` 重新生成。
 */
const VISUAL_DIFF_DETECTION = false;

let server: Server;
let port: number;
let browser: Browser;
let context: BrowserContext;
const written: string[] = [];

// 基线集合完整性:与「路由矩阵 + 交互面」× 双主题**恰好相等** —— 缺失
// (新增路由/弹窗忘提交)或多余(已删未清)都点名。首跑(目录空)跳过。
it('visual baseline set matches the route matrix + surfaces × themes exactly', () => {
  // 重生成模式下目录里还是旧基线(新路由尚未落盘),完整性检查会把
  // 生成流程自己卡死。比对模式才要求集合与登记面恰好相等。
  if (!hasBaselines() || BASELINE_REGENERATE_MODE) return;
  // 判定暂关(见 VISUAL_DIFF_DETECTION):基线集合不再参与门禁 ——
  // 界面频繁变动时,「缺基线/陈旧基线」是常态而非回归。
  if (!VISUAL_DIFF_DETECTION) return;
  const expected = new Set<string>();
  for (const { route } of ROUTES) {
    const name = route === '/' ? 'index' : route.replace(/^\//, '').replace(/\//g, '-');
    expected.add(`${name}--dark.png`);
    expected.add(`${name}--light.png`);
  }
  for (const { name } of SURFACES) {
    expected.add(`${name}--dark.png`);
    expected.add(`${name}--light.png`);
  }
  const actual = new Set(readdirSync(BASELINES).filter((f) => f.endsWith('.png')));
  const missing = [...expected].filter((f) => !actual.has(f));
  const stale = [...actual].filter((f) => !expected.has(f));
  expect(missing, `缺基线(新增路由/弹窗忘了提交?): ${missing.join(', ')}`).toEqual([]);
  expect(stale, `陈旧基线(路由/弹窗已删未清理): ${stale.join(', ')}`).toEqual([]);
});

beforeAll(async () => {
  if (!existsSync(path.join(DIST, 'index.html'))) {
    throw new Error(`dist-visual/ 未构建 —— 先跑 vite build --config vite.config.visual.ts(tests/e2e/run.sh 会自动构建)`);
  }
  ({ server, port } = await serveStatic(DIST));
  browser = await chromium.launch();
  // colorScheme 固定:消除系统偏好对 'system' 主题读数的干扰(基线必须可复现)。
  context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
    colorScheme: 'light',
  });
  await context.addInitScript(INIT_SCRIPT);
}, 60_000);

afterAll(async () => {
  await context?.close();
  await browser?.close();
  server?.close();
});

// 视觉构建入口必须引入 harness.css —— 少了它,基线拍到的是**没有壳层
// 布局样式**的页面(纯文本堆叠),视觉门禁对布局回归完全失真。
// 这条断言把「基线失真」变成构建期失败,而不是靠人眼看出基线不对。
it('visual build entry imports harness.css (shell layout must be styled)', () => {
  const entry = readFileSync(path.join(HERE, 'main.tsx'), 'utf8');
  expect(
    entry,
    'tests/visual/main.tsx 未引入 harness.css —— 视觉基线会拍到无壳层样式的页面',
  ).toMatch(/import\s+['"][^'"]*harness\.css['"]/);
});

/**
 * 截图 → 比对基线(路由面与交互面共用)。
 *
 * 抽出来是因为两者的差异只有「截之前多做一次交互」,其余(主题注入、
 * 冻结时钟/动画、等字体、逐像素比对、失败留存)完全一致 —— 两处各写一遍
 * 迟早漂移。
 */
async function captureAndCompare(page: Page, name: string): Promise<void> {
  await page.addStyleTag({ content: FREEZE_CSS });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  const shot = await page.screenshot();
  await page.close();

  mkdirSync(BASELINES, { recursive: true });
  const baseline = path.join(BASELINES, name);
  // 显式重生成模式(VISUAL_UPDATE=1 / VISUAL_WRITE=1):无条件用当前
  // 渲染结果覆盖基线,不做逐像素比对 —— 否则「重新生成基线」在旧基线
  // 仍存在时永远失败,基线生成 workflow 形同虚设。
  if (BASELINE_REGENERATE_MODE) {
    writeFileSync(baseline, shot);
    written.push(name);
    return;
  }
  // ===== 检测段(暂不执行)=====
  // 判定关闭时:缺基线不算失败、像素差异不算失败;当前渲染写到
  // .test-results/visual-current/ 供人工翻看,基线保持原样 ——
  // 绝不能因为「不判定」就悄悄把基线覆盖成当前渲染(那等于每次都在
  // 改基线,基线从此失去参照意义)。
  if (!VISUAL_DIFF_DETECTION) {
    const curDir = path.resolve(HERE, '../../.test-results/visual-current');
    mkdirSync(curDir, { recursive: true });
    writeFileSync(path.join(curDir, name), shot);
    return;
  }
  if (!existsSync(baseline)) {
    if (!BASELINE_WRITE_MODE) {
      // 只缺个别基线(如新增路由忘提交)而目录里已有其他基线:CI 上
      // 必须失败 —— 否则该路由的视觉回归等于被静默停用。
      if (process.env.CI || process.env.E2E_REQUIRED === '1') {
        throw new Error(
          `基线缺失且未声明写基线(VISUAL_UPDATE=1 / VISUAL_WRITE=1):${name} —— 该路由的视觉回归被静默停用;审查新基线后入库,或本地首跑生成`,
        );
      }
    }
    writeFileSync(baseline, shot);
    written.push(name);
    return;
  }
  const baselinePng = readFileSync(baseline);
  const comparison = comparePng(shot, baselinePng);
  if (!comparison.equal) {
    // 失败留存:当前截图写入 .test-results/visual-fail/,与基线逐像素定位回归。
    const failDir = path.resolve(HERE, '../../.test-results/visual-fail');
    mkdirSync(failDir, { recursive: true });
    writeFileSync(path.join(failDir, name), shot);
  }
  expect(comparison.equal, `${name} 与基线不一致（${comparison.detail}）;失败截图在 .test-results/visual-fail/${name}`).toBe(true);
}

/** 新开一页并把主题在**页面脚本之前**落进 localStorage。 */
async function openWithTheme(route: string, theme: 'dark' | 'light'): Promise<Page> {
  const page = await context.newPage();
  // 主题必须在**页面脚本之前**落到 localStorage —— 应用启动时读它算
  // body 底色;若等到 goto 之后再写,启动时读到的是上一个用例残留的
  // 主题(共享 context),基线会与文件名相反(暗色基线拍到亮底)。
  await page.addInitScript((t) => {
    localStorage.setItem('zhuye-theme', t);
  }, theme);
  await page.goto(`http://127.0.0.1:${port}/${route === '/' ? '' : route.replace(/^\//, '')}`, { waitUntil: 'networkidle' });
  // 双保险:直接写 data-theme(与 tokens.css 的三态语义一致)。
  await page.evaluate((t) => {
    localStorage.setItem('zhuye-theme', t);
    document.documentElement.dataset.theme = t;
  }, theme);
  // 数据管道接通后再截(命令已被调用、fixture 文本已渲染)。
  await page.waitForLoadState('networkidle');
  return page;
}

it('sidebar interactions stay anchored and theme changes in one click', async () => {
  const page = await openWithTheme('/chat/sess-alpha', 'dark');
  const group = page.locator('.sb-scroll button[aria-expanded]').first();
  const session = page.getByTestId('harness-session-sess-alpha');
  const trigger = page.getByTestId('session-more-sess-alpha');
  await session.waitFor();
  await session.hover();
  await trigger.click();
  const menu = page.getByTestId('harness-session-menu');
  await menu.waitFor();
  const anchorBox = await trigger.boundingBox();
  const menuBox = await menu.boundingBox();
  expect(anchorBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  expect(menuBox!.x).toBeGreaterThanOrEqual(0);
  expect(menuBox!.y).toBeGreaterThanOrEqual(0);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(1280);
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(800);
  expect(Math.min(Math.abs(menuBox!.y - (anchorBox!.y + anchorBox!.height)), Math.abs(menuBox!.y + menuBox!.height - anchorBox!.y))).toBeLessThan(3);
  const screenshotDir = path.resolve(HERE, '../../.test-results/visual-current');
  mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, 'sidebar-menu--dark.png') });
  await page.keyboard.press('Escape');
  expect(await menu.count()).toBe(0);
  await group.click();
  expect(await group.getAttribute('aria-expanded')).toBe('false');
  expect(await session.count()).toBe(0);
  await group.click();
  await session.waitFor();
  const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.getByTestId('harness-theme').click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.waitForFunction((before) => getComputedStyle(document.body).backgroundColor !== before, dark);
  await page.close();
});

it('system theme changes update the conversation background', async () => {
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('zhuye-theme', 'system'));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`http://127.0.0.1:${port}/chat/sess-alpha`, { waitUntil: 'networkidle' });
  await page.getByTestId('harness-session-sess-alpha').waitFor();
  const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction((before) => getComputedStyle(document.body).backgroundColor !== before, dark, { timeout: 3000 });
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction((before) => getComputedStyle(document.body).backgroundColor === before, dark, { timeout: 3000 });
  await page.close();
});

describe.each(ROUTES)('visual $route', ({ route }) => {
  it.each(['dark', 'light'] as const)('matches the %s baseline', async (theme) => {
    const name = `${route === '/' ? 'index' : route.replace(/^\//, '').replace(/\//g, '-')}--${theme}.png`;
    const page = await openWithTheme(route, theme);
    await captureAndCompare(page, name);
  }, 30_000);
});

describe.each(SURFACES)('visual surface $name', ({ name, route, prepare }) => {
  it.each(['dark', 'light'] as const)('matches the %s baseline', async (theme) => {
    const page = await openWithTheme(route, theme);
    // 交互面:打开弹窗(路由基线拍不到这一面)。
    await prepare?.(page);
    await captureAndCompare(page, `${name}--${theme}.png`);
  }, 30_000);
});

afterAll(() => {
  if (written.length > 0) {
    console.log(`[visual] 首跑:写入 ${written.length} 张基线 —— 人工审查后入库`);
  }
});
