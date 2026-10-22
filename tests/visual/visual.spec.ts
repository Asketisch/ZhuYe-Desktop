/**
 * 视觉回归 —— 全路由 × dark/light 截图基线。
 *
 * 前提:`vite build --config vite.config.visual.ts` 已产出 `dist-visual/`
 * (真实前端 + fakeBackend shim 的浏览器态构建),由本文件顶部的静态服务
 * 起来。路由表与行为/axe 三处同源(`helpers/routeMatrix.ts`)。
 *
 * 基线策略(与门禁其他棘轮一致):
 *   - 无基线目录时 = 首跑,落盘基线并直接通过(报告写明 "written");
 *   - 有基线时逐像素比对,不一致即 FAIL(布局/主题回归零容忍);
 *   - 重生成基线:删除 `tests/visual/__baselines__/` 后重跑,人工审查
 *     diff 后入库。
 *
 * 由 `tests/e2e/run.sh` 调用(Playwright 由该脚本按需 `pnpm dlx` 安装)。
 */
import { createServer, type Server } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { ROUTES } from '../helpers/routeMatrix';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, '../../dist-visual');
const BASELINES = path.join(HERE, '__baselines__');

//
// 确定性锚点 —— 视觉基线是逐字节比对,任何像素漂移即 FAIL,因此:
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

let server: Server;
let port: number;
let browser: Browser;
let context: BrowserContext;
const written: string[] = [];

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
    if (!hasBaselines() || !existsSync(baseline)) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(baseline, shot);
      written.push(name);
      return;
    }
    const baselinePng = readFileSync(baseline);
    if (!shot.equals(baselinePng)) {
      // 失败留存:当前截图写入 .test-results/visual-fail/,与基线逐像素定位回归。
      const failDir = path.resolve(HERE, '../../.test-results/visual-fail');
      mkdirSync(failDir, { recursive: true });
      writeFileSync(path.join(failDir, name), shot);
    }
    expect(shot.equals(baselinePng), `${name} 与基线不一致 —— 布局/主题回归;失败截图在 .test-results/visual-fail/${name};审查后删除 __baselines__/${name} 重跑可重生成`).toBe(true);
  }, 30_000);
});

afterAll(() => {
  if (written.length > 0) {
    console.log(`[visual] 首跑:写入 ${written.length} 张基线 —— 人工审查后入库`);
  }
});
