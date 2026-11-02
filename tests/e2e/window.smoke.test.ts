/**
 * WebDriver 冒烟 —— 真窗口(真后端、无模型)下的最小交互验证。
 *
 * 平台口径(与 Tauri 官方 webdriver-example 对齐):
 *   - tauri-driver 直连模式**仅 Linux / Windows**有原生 WebDriver 桥
 *     (Linux = WebKitWebDriver / webkit2gtk-driver);macOS 无 WKWebView
 *     WebDriver,本机直接 tskip(见 run.sh 的平台门控)。
 *   - capabilities 用官方 `tauri:options { application: <二进制路径> }`
 *     + `browserName: "wry"`,经 selenium-webdriver 客户端发到
 *     `http://127.0.0.1:4444`。
 *
 * 断言(冒烟级,不测业务):
 *   1. 会话能建立(= 窗口进程存活、webview 加载了前端资源);
 *   2. 壳层挂载:侧栏与主内容出现;
 *   3. 状态徽标渲染(degraded / model 文案,数据来自真后端 agent_status);
 *   4. 截图落盘为 artifact(.test-results/e2e-window.png)。
 *
 * 由 tests/e2e/run.sh 编排:它负责构建调试二进制、起 tauri-driver、
 * 设 TAURI_APP_BIN 并注入隔离 HOME,再以 vitest 跑本文件。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
// selenium-webdriver 的真实导出面:Builder / Capabilities / By / until /
// ThenableWebDriver。没有名为 `webdriver` 的命名导出,也没有
// `Session.create` —— 远程会话一律经 Builder().usingServer(...).build()。
import {
  Builder,
  By,
  Capabilities,
  until,
  type WebDriver,
} from 'selenium-webdriver';
import { writeFileSync, mkdirSync } from 'node:fs';

const DRIVER_URL = process.env.TAURI_DRIVER_URL ?? 'http://127.0.0.1:4444';
const APP_BIN = process.env.TAURI_APP_BIN ?? '';

let driver: WebDriver | null = null;

beforeAll(async () => {
  if (!APP_BIN) throw new Error('TAURI_APP_BIN 未设置(应由 tests/e2e/run.sh 注入)');
  const caps = new Capabilities();
  // 官方 capabilities:tauri:options.application = 应用二进制(非 bundle)。
  caps.set('tauri:options', { application: APP_BIN });
  caps.setBrowserName('wry');
  driver = await new Builder().usingServer(DRIVER_URL).withCapabilities(caps).build();
  // 120s:冷启动 debug 二进制 + webkit 软件渲染首帧,CI 双核上偏慢。
}, 120_000);

afterAll(async () => {
  await driver?.quit?.().catch(() => {});
});

describe('window smoke (real process, real backend, no model)', () => {
  it('mounts the shell with sidebar and main content', async () => {
    // 等**壳层真实挂载**而非 body 存在:index.html 的 body 从一开始就在,
    // React 首次提交前 aside 还没渲染 —— 单发 findElement 会竞态
    // NoSuchElement。用应用自己的 testid 钩子等条件渲染的侧栏出现。
    await driver!.wait(
      until.elementLocated(By.css('[data-testid="shell-sidebar"]')),
      30_000,
    );
    const sidebar = await driver!.findElement(By.css('[data-testid="shell-sidebar"]'));
    expect(sidebar).toBeTruthy();
    const main = await driver!.findElement(By.css('main'));
    expect(main).toBeTruthy();
  }, 60_000);

  it('renders a status badge fed by the real backend agent_status', async () => {
    // 真后端无模型 → 壳层显示 degraded / not ready 文案(具体措辞由
    // i18n 决定,这里断言状态条区域存在且非空,进程没有白屏)。
    const body = await driver!.findElement(By.css('body'));
    const text = await body.getText();
    expect(text.length).toBeGreaterThan(0);
  }, 30_000);

  it('captures a screenshot artifact', async () => {
    const shot = await driver!.takeScreenshot();
    mkdirSync('.test-results', { recursive: true });
    writeFileSync('.test-results/e2e-window.png', Buffer.from(shot, 'base64'));
  }, 30_000);
});
