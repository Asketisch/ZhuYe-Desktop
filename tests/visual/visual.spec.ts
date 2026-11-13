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
 * 由 `tests/e2e/run.sh` 调用(Playwright 由该脚本按需 `pnpm dlx` 安装)。
 */
import { createServer, type Server } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
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

let server: Server;
let port: number;
let browser: Browser;
let context: BrowserContext;
const written: string[] = [];

// 基线集合完整性:与路由矩阵 × 双主题**恰好相等** —— 缺失(新增路由忘
// 提交)或多余(路由已删基线未清)都点名。首跑(目录空)跳过。
it('visual baseline set matches the route matrix × themes exactly', () => {
  if (!hasBaselines()) return;
  const expected = new Set<string>();
  for (const { route } of ROUTES) {
    const name = route === '/' ? 'index' : route.replace(/^\//, '').replace(/\//g, '-');
    expected.add(`${name}--dark.png`);
    expected.add(`${name}--light.png`);
  }
  const actual = new Set(readdirSync(BASELINES).filter((f) => f.endsWith('.png')));
  const missing = [...expected].filter((f) => !actual.has(f));
  const stale = [...actual].filter((f) => !expected.has(f));
  expect(missing, `缺基线(新增路由忘了提交?): ${missing.join(', ')}`).toEqual([]);
  expect(stale, `陈旧基线(路由已删未清理): ${stale.join(', ')}`).toEqual([]);
});

beforeAll(async () => {
  if (!existsSync(path.join(DIST, 'index.html'))) {
    throw new Error(`dist-visual/ 未构建 —— 先跑 vite build --config vite.config.visual.ts(tests/e2e/run.sh 会自动构建)`);
  }
  ({ server, port } = await serveStatic(DIST));
  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  await context.addInitScript(INIT_SCRIPT);
}, 60_000);

afterAll(async () => {
  await context?.close();
  await browser?.close();
  server?.close();
});

describe.each(ROUTES)('visual $route', ({ route }) => {
  it.each(['dark', 'light'] as const)('matches the %s baseline', async (theme) => {
    const name = `${route === '/' ? 'index' : route.replace(/^\//, '').replace(/\//g, '-')}--${theme}.png`;
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/${route === '/' ? '' : route.replace(/^\//, '')}`, { waitUntil: 'networkidle' });
    // 固定主题:写 localStorage + data-theme,与 tokens.css 的三态语义一致。
    await page.evaluate((t) => {
      localStorage.setItem('reflect-theme', t);
      document.documentElement.dataset.theme = t;
    }, theme);
    // 首页数据管道接通后再截(命令已被调用、fixture 文本已渲染)。
    await page.waitForLoadState('networkidle');
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
      const { writeFileSync } = await import('node:fs');
      writeFileSync(baseline, shot);
      written.push(name);
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
      const { writeFileSync } = await import('node:fs');
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
  }, 30_000);
});

afterAll(() => {
  if (written.length > 0) {
    console.log(`[visual] 首跑:写入 ${written.length} 张基线 —— 人工审查后入库`);
  }
});
