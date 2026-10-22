/** 手动调试:起静态服务 + headless Chromium,抓 console 错误与 DOM 状态。 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, '../../dist-visual');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

const server = createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  let file = path.join(DIST, url);
  if (!existsSync(file) || url === '/') file = path.join(DIST, 'index.html');
  try {
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', () => r(null)));
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 500)));
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const html = await page.evaluate(() => ({
  rootHtmlLen: document.getElementById('root')?.innerHTML.length ?? -1,
  bodyStart: document.body.innerHTML.slice(0, 200),
}));
console.log(JSON.stringify(html, null, 2));
await browser.close();
server.close();
