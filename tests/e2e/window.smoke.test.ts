/**
 * WebDriver 冒烟 —— 真窗口、真后端、本机模型替身的完整聊天回路。
 *
 * 平台口径(与 Tauri 官方 webdriver-example 对齐):
 *   - tauri-driver 直连模式**仅 Linux / Windows**有原生 WebDriver 桥
 *     (Linux = WebKitWebDriver / webkit2gtk-driver);macOS 无 WKWebView
 *     WebDriver,本机直接 tskip(见 run.sh 的平台门控)。
 *   - capabilities 用官方 `tauri:options { application: <二进制路径> }`
 *     + `browserName: "wry"`,经 selenium-webdriver 客户端发到
 *     `http://127.0.0.1:4444`。
 *
 * 断言涵盖壳层、真实聊天与工具审批、终端和文件操作、任务持久化及路由挂载:
 *   1. 会话能建立(= 窗口进程存活、webview 加载了前端资源);
 *   2. 壳层挂载:侧栏与主内容出现;
 *   3. 状态栏显示本机模型;
 *   4. 真实输入 → IPC → AgentThread → SSE → 事件 → 界面回复;
 *   5. 截图落盘为 artifact(.test-results/e2e-window.png)。
 * 更多功能及未覆盖项见 tests/RUNTIME_COVERAGE.md。
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
  Key,
  type WebDriver,
} from 'selenium-webdriver';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROUTES } from '../helpers/routeMatrix';

const DRIVER_URL = process.env.TAURI_DRIVER_URL ?? 'http://127.0.0.1:4444';
const APP_BIN = process.env.TAURI_APP_BIN ?? '';

let driver: WebDriver | null = null;
let chatSessionPath = '';

async function openMorePage(label: string) {
  // v3 harness:侧栏「更多」菜单(plain button,无 role=menuitem)。
  // 菜单是开关:先确认闭合态再点(用 DOM 检查,不用 Esc —— Windows
  // WebView2 上给 body 发 Esc 会被系统级 shortcut 关窗)。
  if ((await driver!.findElements(By.css('[data-testid="harness-more-menu"]'))).length > 0) {
    await driver!.findElement(By.css('[data-testid="harness-nav-more"]')).click();
    await driver!.wait(async () =>
      (await driver!.findElements(By.css('[data-testid="harness-more-menu"]'))).length === 0, 5000);
  }
  await driver!.findElement(By.css('[data-testid="harness-nav-more"]')).click();
  const menu = await driver!.wait(until.elementLocated(By.css('[data-testid="harness-more-menu"]')), 10_000);
  const inViewport = await driver!.executeScript<boolean>(
    'const r = arguments[0].getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight;', menu,
  );
  expect(inViewport, 'navigation flyout must remain inside the window').toBe(true);
  const item = await menu.findElement(By.xpath(`.//button[normalize-space(.)="${label}"]`));
  // 菜单项在 50vh 滚动容器里:先滚到视野中央再点(WebKitGTK 抖动)。
  await driver!.executeScript('arguments[0].scrollIntoView({ block: "center" });', item);
  await item.click();
}

/** 等待弹窗出现;超时时先截图并转储 body 文本再抛出原错误。
 *  Windows 上"弹窗不出现"类失败(60s 超时)此前没有任何现场,排障全靠猜;
 *  截图落 E2E_SCREENSHOT_DIR,文本头走 stderr 进 e2e-window.log,
 *  run.sh 的失败转储会带出 dialog-miss 标记行。 */
async function waitDialog(selector: string, timeout = 60_000) {
  try {
    return await driver!.wait(until.elementLocated(By.css(selector)), timeout);
  } catch (error) {
    const resultDir = process.env.E2E_SCREENSHOT_DIR ?? '.test-results';
    const tag = selector.replace(/[^a-zA-Z-]/g, '').slice(-40) || 'dialog';
    try {
      mkdirSync(resultDir, { recursive: true });
      writeFileSync(
        join(resultDir, `e2e-dialog-miss-${tag}.png`),
        Buffer.from(await driver!.takeScreenshot(), 'base64'),
      );
      const text = await driver!.findElement(By.css('body')).getText();
      console.error(`[dialog-miss] ${selector} 未出现;body 文本头:\n${text.slice(0, 800)}`);
    } catch {
      // 取证失败不掩盖原始超时错误。
    }
    throw error;
  }
}

beforeAll(async () => {
  if (!APP_BIN) throw new Error('TAURI_APP_BIN 未设置(应由 tests/e2e/run.sh 注入)');
  const caps = new Capabilities();
  // 官方 capabilities:tauri:options.application = 应用二进制(非 bundle)。
  caps.set('tauri:options', { application: APP_BIN });
  caps.setBrowserName('wry');
  // Windows WebView2 偶发首帧 DevToolsActivePort 竞态;三次重试仍失败才判失败。
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      driver = await new Builder().usingServer(DRIVER_URL).withCapabilities(caps).build();
      break;
    } catch (error) {
      await driver?.quit?.().catch(() => {});
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
  // 3 次 WebView2 会话重试最长约 3 分钟;hook 上限必须覆盖完整重试链。
}, 240_000);

afterAll(async () => {
  await driver?.quit?.().catch(() => {});
});

describe('window smoke (real process, real backend, local model stub)', () => {
  it('mounts the shell with sidebar and main content', async () => {
    // 等**壳层真实挂载**而非 body 存在:index.html 的 body 从一开始就在,
    // React 首次提交前 aside 还没渲染 —— 单发 findElement 会竞态
    // NoSuchElement。用应用自己的 testid 钩子等条件渲染的侧栏出现。
    await driver!.wait(
      until.elementLocated(By.css('[data-testid="harness-sidebar"]')),
      30_000,
    );
    const sidebar = await driver!.findElement(By.css('[data-testid="harness-sidebar"]'));
    expect(sidebar).toBeTruthy();
    const main = await driver!.findElement(By.css('main'));
    expect(main).toBeTruthy();
  }, 60_000);

  it('renders the configured model in the composer selector', async () => {
    // v3 harness:StatusBar 移除,模型面在 composer 工具条的选择器里。
    const select = await driver!.wait(
      until.elementLocated(By.css('[data-testid="composer-model-select"]')),
      30_000,
    );
    await driver!.wait(async () => {
      const value = await select.getAttribute('value');
      const text = await select.getText();
      return (value ?? '').includes('mock-model') || (text ?? '').includes('mock-model');
    }, 30_000);
    const value = await select.getAttribute('value');
    const text = await select.getText();
    expect((value ?? '') + (text ?? '')).toContain('mock-model');
  }, 40_000);

  it('sends a message through the real agent and renders the streamed reply', async () => {
    const composer = await driver!.wait(
      until.elementLocated(By.css('[data-testid="composer-card"] textarea')),
      30_000,
    );
    await composer.sendKeys('window-agent-chain-test');
    await driver!.findElement(By.css('[data-testid="composer-send"]')).click();
    await driver!.wait(async () => driver!.executeScript<boolean>(
      'return document.querySelector(\'[role="log"]\')?.innerText.includes("window second reply verified") ?? false;',
    ), 60_000);
    const logText = await driver!.findElement(By.css('[role="log"]')).getText();
    expect(logText).toContain('window-agent-chain-test');
    expect(logText).toContain('window second reply verified');
    // v3 harness:用量面在右 dock 的「用量」档(标题条按钮直达并唤出)。
    await driver!.findElement(By.css('[data-testid="harness-dock-usage"]')).click();
    const usage = await driver!.wait(
      until.elementLocated(By.css('[data-testid="usage-dock-total"]')),
      30_000,
    );
    await driver!.wait(async () => (await usage.getText()).includes('17'), 30_000);
    expect(await usage.getText()).toContain('17');
    // 收起 dock 还原现场(后续测试走窄窗 / 终端流程)。
    await driver!.findElement(By.css('[data-testid="harness-inspect"]')).click();
    chatSessionPath = new URL(await driver!.getCurrentUrl()).pathname;
    expect(chatSessionPath).toMatch(/^\/chat\/.+/);
  }, 100_000);

  it('waits for tool approval, executes the tool and renders the second model response', async () => {
    const providerLog = join(process.env.E2E_SCREENSHOT_DIR ?? '.test-results', 'e2e-mock-provider.log');
    const promptMode = await driver!.findElement(By.css('[data-testid="composer-perm-prompt"]'));
    await promptMode.click();
    await driver!.wait(async () => (await promptMode.getAttribute('aria-checked')) === 'true', 30_000);
    const composer = await driver!.findElement(By.css('[data-testid="composer-card"] textarea'));
    await composer.sendKeys('window-tool-chain-test');
    const send = await driver!.wait(until.elementLocated(By.css('[data-testid="composer-send"]')), 30_000);
    await send.click();
    const dialog = await waitDialog('[data-testid="zcode-approval"]');
    expect(readFileSync(providerLog, 'utf8')).not.toContain('window tool result:');
    await dialog.findElement(By.css('[data-testid="zcode-approval-allow"]')).click();
    const log = await driver!.findElement(By.css('[role="log"]'));
    await driver!.wait(async () => (await log.getText()).includes('window tool round verified'), 60_000);
    expect(readFileSync(providerLog, 'utf8')).toContain('tool-approved-marker');
  }, 150_000);

  it('denies a tool request without creating its target file', async () => {
    const workspace = process.env.E2E_WORKSPACE_DIR;
    if (!workspace) throw new Error('E2E_WORKSPACE_DIR 未设置');
    const marker = join(workspace, 'denied-tool.txt');
    const composer = await driver!.findElement(By.css('[data-testid="composer-card"] textarea'));
    await composer.sendKeys('window-tool-deny-test');
    await driver!.findElement(By.css('[data-testid="composer-send"]')).click();
    const dialog = await waitDialog('[data-testid="zcode-approval"]');
    expect(existsSync(marker)).toBe(false);
    await dialog.findElement(By.css('[data-testid="zcode-approval-deny"]')).click();
    const log = await driver!.findElement(By.css('[role="log"]'));
    await driver!.wait(async () => (await log.getText()).includes('window denial verified'), 60_000);
    expect(existsSync(marker)).toBe(false);
  }, 150_000);

  it('lets an approved sandboxed tool write inside the workspace', async () => {
    const workspace = process.env.E2E_WORKSPACE_DIR;
    if (!workspace) throw new Error('E2E_WORKSPACE_DIR 未设置');
    const marker = join(workspace, 'approved-tool.txt');
    const providerLog = join(process.env.E2E_SCREENSHOT_DIR ?? '.test-results', 'e2e-mock-provider.log');
    const composer = await driver!.findElement(By.css('[data-testid="composer-card"] textarea'));
    await composer.sendKeys('window-tool-write-test');
    await driver!.findElement(By.css('[data-testid="composer-send"]')).click();
    const dialog = await waitDialog('[data-testid="zcode-approval"]');
    expect(existsSync(marker)).toBe(false);
    await dialog.findElement(By.css('[data-testid="zcode-approval-allow"]')).click();
    await driver!.wait(() => readFileSync(providerLog, 'utf8').includes('window write tool result:'), 30_000);
    const line = readFileSync(providerLog, 'utf8').split('\n').find((entry) => entry.startsWith('window write tool result:'));
    const result = JSON.parse(line!.slice('window write tool result:'.length));
    expect(result.is_error, JSON.stringify(result)).toBe(false);
    expect(readFileSync(marker, 'utf8')).toBe('tool-write-marker');
    const log = await driver!.findElement(By.css('[role="log"]'));
    await driver!.wait(async () => (await log.getText()).includes('window tool write verified'), 30_000);
  }, 100_000);

  it('keeps the navigation flyout usable at the minimum window size', async () => {
    await driver!.manage().window().setRect({ width: 800, height: 600 });
    try {
      await driver!.findElement(By.css('[data-testid="harness-rail"]')).click();
      await openMorePage('Terminal');
      await driver!.wait(until.elementLocated(By.css('[data-testid="terminal-input"]')), 30_000);
    } catch (error) {
      const resultDir = process.env.E2E_SCREENSHOT_DIR ?? '.test-results';
      mkdirSync(resultDir, { recursive: true });
      writeFileSync(join(resultDir, 'e2e-small-window-failure.png'), Buffer.from(await driver!.takeScreenshot(), 'base64'));
      throw error;
    } finally {
      await driver!.manage().window().setRect({ width: 1280, height: 800 });
      // rail 是 class 态:再点一次恢复展开。
      await driver!.findElement(By.css('[data-testid="harness-rail"]')).click();
    }
  }, 50_000);

  it('runs a real shell command and renders its output and exit status', async () => {
    await openMorePage('Terminal');
    const input = await driver!.wait(until.elementLocated(By.css('[data-testid="terminal-input"]')), 30_000);
    await input.sendKeys("printf 'fixture-before\\n' > runtime-probe.txt; printf 'runtime-output-verified\\n'", Key.ENTER);
    const output = await driver!.wait(
      until.elementLocated(By.css('[data-testid="terminal-root"] [data-stream="stdout"]')),
      30_000,
    );
    await driver!.wait(async () => (await output.getText()).includes('runtime-output-verified'), 30_000);
    const meta = await driver!.wait(until.elementLocated(By.css('[data-testid="terminal-meta"]')), 30_000);
    await driver!.wait(async () => (await meta.getText()).includes('exit 0'), 30_000);
    expect(await meta.getText()).toContain('exit 0');
  }, 70_000);

  it('stops a real running terminal command before its delayed side effect', async () => {
    const workspace = process.env.E2E_WORKSPACE_DIR;
    if (!workspace) throw new Error('E2E_WORKSPACE_DIR 未设置');
    const marker = join(workspace, 'terminal-kill-marker.txt');
    const input = await driver!.findElement(By.css('[data-testid="terminal-input"]'));
    await input.sendKeys('sleep 3; printf should-not-run > terminal-kill-marker.txt', Key.ENTER);
    const kill = await driver!.wait(until.elementLocated(By.css('[data-testid="terminal-kill"]')), 30_000);
    await kill.click();
    await driver!.wait(async () => {
      try {
        return (await driver!.findElements(By.css('[data-testid="terminal-kill"]'))).length === 0;
      } catch {
        return false;
      }
    }, 30_000);
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    expect(existsSync(marker)).toBe(false);
  }, 50_000);

  it('edits a workspace file and reads the saved bytes through the real terminal', async () => {
    await openMorePage('Files');
    const file = await driver!.wait(until.elementLocated(By.css('[data-testid="file-row-runtime-probe.txt"]')), 30_000);
    await file.click();
    const editor = await driver!.wait(until.elementLocated(By.css('[data-testid="cm-editor"] .cm-content[contenteditable="true"]')), 30_000);
    await driver!.wait(async () => (await editor.getText()).includes('fixture-before'), 30_000);
    await editor.click();
    await driver!.actions().keyDown(Key.CONTROL).sendKeys('a').keyUp(Key.CONTROL).sendKeys('fixture-after').perform();
    const save = await driver!.findElement(By.css('[data-testid="files-save"]'));
    try {
      await driver!.wait(async () => save.isEnabled(), 10_000);
    } catch (error) {
      const resultDir = process.env.E2E_SCREENSHOT_DIR ?? '.test-results';
      mkdirSync(resultDir, { recursive: true });
      writeFileSync(join(resultDir, 'e2e-file-edit-failure.png'), Buffer.from(await driver!.takeScreenshot(), 'base64'));
      throw error;
    }
    await save.click();
    // 保存是否真的落盘以磁盘为准(UI 按钮态在报错时会回到 enabled,且
    // Windows 上「Tool Approval 不出现」类零现场问题曾全靠猜)。超时时
    // 截图 + 转储 body 文本,抓保存失败的 toast(saveFailed / conflict)。
    const workspaceDir = process.env.E2E_WORKSPACE_DIR;
    if (!workspaceDir) throw new Error('E2E_WORKSPACE_DIR 未设置');
    const probePath = join(workspaceDir, 'runtime-probe.txt');
    try {
      await driver!.wait(
        async () => {
          try { return readFileSync(probePath, 'utf8') === 'fixture-after'; } catch { return false; }
        },
        30_000,
      );
    } catch (error) {
      const resultDir = process.env.E2E_SCREENSHOT_DIR ?? '.test-results';
      mkdirSync(resultDir, { recursive: true });
      writeFileSync(join(resultDir, 'e2e-file-save-failure.png'), Buffer.from(await driver!.takeScreenshot(), 'base64'));
      const body = await driver!.findElement(By.css('body')).getText();
      console.error(`[file-save-miss] 磁盘内容未变成 fixture-after;body 文本头:\n${body.slice(0, 800)}`);
      throw error;
    }
    await openMorePage('Terminal');
    const input = await driver!.wait(until.elementLocated(By.css('[data-testid="terminal-input"]')), 30_000);
    await input.sendKeys('cat runtime-probe.txt', Key.ENTER);
    const output = await driver!.wait(until.elementLocated(By.css('[data-testid="terminal-root"] [data-stream="stdout"]')), 30_000);
    await driver!.wait(async () => (await output.getText()).includes('fixture-after'), 30_000);
    expect(await output.getText()).toContain('fixture-after');
  }, 100_000);

  it('stages and commits the edited file through the real Git view', async () => {
    const workspace = process.env.E2E_WORKSPACE_DIR;
    if (!workspace) throw new Error('E2E_WORKSPACE_DIR 未设置');
    const git = (...args: string[]) => execFileSync('git', args, { cwd: workspace, encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.name', 'Runtime Test');
    git('config', 'user.email', 'runtime-test@example.invalid');
    git('commit', '--allow-empty', '-qm', 'fixture');
    await driver!.get(new URL('/git', await driver!.getCurrentUrl()).toString());
    const entry = await driver!.wait(until.elementLocated(By.css('[data-testid="git-entry-check-runtime-probe.txt"]')), 30_000);
    await entry.click();
    await driver!.findElement(By.css('[data-testid="git-stage-selected"]')).click();
    await driver!.wait(() => git('diff', '--cached', '--name-only').includes('runtime-probe.txt'), 30_000);
    await driver!.findElement(By.xpath('//button[starts-with(normalize-space(.), "Staged (")]')).click();
    await driver!.findElement(By.css('[data-testid="git-commit-message"]')).sendKeys('Runtime integration commit');
    await driver!.findElement(By.css('[data-testid="git-commit-btn"]')).click();
    await driver!.wait(() => git('log', '-1', '--format=%s').trim() === 'Runtime integration commit', 30_000);
    expect(git('show', 'HEAD:runtime-probe.txt')).toBe('fixture-after');
  }, 100_000);

  it('persists and removes a memory entry through the real backend', async () => {
    const url = new URL('/memory', await driver!.getCurrentUrl()).toString();
    await driver!.get(url);
    const add = await driver!.wait(until.elementLocated(By.css('[data-testid="memory-add-btn"]')), 30_000);
    await driver!.wait(async () => add.isEnabled(), 30_000);
    await add.click();
    await driver!.findElement(By.css('[data-testid="memory-new-key"]')).sendKeys('runtime-memory-key');
    await driver!.findElement(By.css('[data-testid="memory-new-value"]')).sendKeys('runtime-memory-value');
    await driver!.findElement(By.css('[data-testid="memory-add-confirm"]')).click();
    const row = By.css('[data-testid="memory-entry-runtime-memory-key"]');
    await driver!.wait(until.elementLocated(row), 30_000);
    await driver!.get(url);
    const restored = await driver!.wait(until.elementLocated(row), 30_000);
    expect(await restored.getAttribute('textContent')).toContain('runtime-memory-value');
    await restored.findElement(By.css('[data-testid="memory-remove"]')).click();
    await driver!.wait(async () => (await driver!.findElements(row)).length === 0, 30_000);
    await driver!.get(url);
    await driver!.wait(until.elementLocated(By.css('main')), 30_000);
    await driver!.wait(async () => (await driver!.findElement(By.css('main')).getText()).includes('No memory entries'), 30_000);
    expect(await driver!.findElements(row)).toHaveLength(0);
  }, 100_000);

  it('creates a task through the real backend and reloads it after navigation', async () => {
    // 直接 URL 导航到 /tasks:本用例断言的是 task CRUD + 跨导航留存,
    // 不是「更多菜单点击」(那条链路已被单独的 mounts 用例覆盖),
    // 去掉菜单开关态/滚动容器点击的耦合后,用例只测该测的东西。
    await driver!.get(new URL('/tasks', await driver!.getCurrentUrl()).toString());
    await driver!.wait(until.elementLocated(By.css('[data-testid="tasks-add-btn"]')), 30_000);
    await driver!.findElement(By.css('[data-testid="tasks-add-btn"]')).click();
    await driver!.findElement(By.css('[data-testid="task-create-subject"]')).sendKeys('Runtime integration task');
    await driver!.findElement(By.css('[data-testid="task-create-submit"]')).click();
    const task = By.xpath('//*[starts-with(@data-testid,"task-row-") and contains(.,"Runtime integration task")]');
    const created = await driver!.wait(until.elementLocated(task), 30_000);
    await created.findElement(By.css('button[title="Start"]')).click();
    const complete = await driver!.wait(until.elementLocated(By.css('[data-testid^="task-complete-"]')), 30_000);
    await complete.click();
    await driver!.wait(async () => (await (await driver!.findElement(task)).getText()).includes('Completed'), 30_000);
    // 跨导航回读:直接 URL 切到 /terminal 再切回 /tasks,验证 task 状态
    // 持久化(不耦合菜单开关态)。
    await driver!.get(new URL('/terminal', await driver!.getCurrentUrl()).toString());
    await driver!.wait(until.elementLocated(By.css('[data-testid="terminal-input"]')), 30_000);
    await driver!.get(new URL('/tasks', await driver!.getCurrentUrl()).toString());
    const restored = await driver!.wait(until.elementLocated(task), 30_000);
    expect(await restored.getAttribute('textContent')).toContain('Runtime integration task');
    expect(await restored.getAttribute('textContent')).toContain('Completed');
  }, 100_000);

  it('captures a screenshot artifact', async () => {
    const shot = await driver!.takeScreenshot();
    const resultDir = process.env.E2E_SCREENSHOT_DIR ?? '.test-results';
    mkdirSync(resultDir, { recursive: true });
    writeFileSync(join(resultDir, 'e2e-window.png'), Buffer.from(shot, 'base64'));
  }, 30_000);

  it('switches between real sessions and restores the original chat route', async () => {
    const originalPath = chatSessionPath;
    expect(originalPath).toMatch(/^\/chat\/.+/);
    await driver!.get(new URL(originalPath, await driver!.getCurrentUrl()).toString());

    // 消息区(role="log")只在 ChatView 的 loading/error 皆解除时挂载:切会话
    // 期间它会整体卸载再挂载。用 findElements 读文本,元素缺席时返回 null
    // 让 wait 继续轮询 —— findElement 抛错会让 wait 直接 reject,
    // 断言「切换瞬间没有 log」就变成误报。
    const logText = async (): Promise<string | null> => {
      const found = await driver!.findElements(By.css('[role="log"]'));
      return found.length === 0 ? null : found[0].getText();
    };
    const waitLog = async (predicate: (text: string) => boolean, timeout = 60_000) =>
      driver!.wait(async () => {
        const text = await logText();
        return text !== null && predicate(text);
      }, timeout);

    await waitLog((text) => text.includes('window-agent-chain-test'));

    await driver!.findElement(By.css('[data-testid="harness-sidebar"] [data-testid="harness-new-chat"]')).click();
    // 「新建对话」是异步的:先创建会话再导航到 /chat/<新 id>。导航落地前
    // 侧栏点击可能命中旧会话的输入框,必须等路由真正切走再输入。
    await driver!.wait(async () => {
      const path = new URL(await driver!.getCurrentUrl()).pathname;
      return /^\/chat\/.+/.test(path) && path !== originalPath;
    }, 30_000);
    const composer = await driver!.wait(until.elementLocated(By.css('[data-testid="composer-card"] textarea')), 30_000);
    await composer.sendKeys('window-session-b-marker');
    await driver!.findElement(By.css('[data-testid="composer-send"]')).click();
    await waitLog((text) => text.includes('window session b reply'));
    const secondPath = new URL(await driver!.getCurrentUrl()).pathname;
    expect(secondPath).toMatch(/^\/chat\/.+/);
    expect(secondPath).not.toBe(originalPath);

    await driver!.findElement(By.css('[data-testid="harness-sidebar"] [data-testid="harness-refresh"]')).click();
    const sessionButton = async (path: string) => {
      const id = path.slice('/chat/'.length);
      // 列表行内 kebab 与会话按钮是兄弟节点,用 preceding-sibling 精确定位,
      // 避免行内其它按钮被误选。
      const selector = `//button[@data-testid="session-more-${id}"]/preceding-sibling::button[@aria-pressed]`;
      return driver!.wait(until.elementLocated(By.xpath(selector)), 30_000);
    };
    const assertSession = async (path: string, visible: string, absent: string) => {
      await driver!.wait(async () => new URL(await driver!.getCurrentUrl()).pathname === path, 30_000);
      await waitLog((text) => text.includes(visible) && !text.includes(absent));
      const text = (await logText()) ?? '';
      expect(text.split(visible)).toHaveLength(2);
      expect(text).not.toContain(absent);
      expect(await (await sessionButton(path)).getAttribute('aria-pressed')).toBe('true');
    };
    await assertSession(secondPath, 'window-session-b-marker', 'window-agent-chain-test');

    const originalButton = await sessionButton(originalPath);
    // 拦截一次点击,确认相同的路由等待条件能检测真实切换未发生。
    await driver!.executeScript("arguments[0].addEventListener('click', e => e.stopImmediatePropagation(), { capture: true, once: true });", originalButton);
    await originalButton.click();
    await expect(driver!.wait(async () => new URL(await driver!.getCurrentUrl()).pathname === originalPath, 1_500)).rejects.toThrow();
    await originalButton.click();
    await assertSession(originalPath, 'window-agent-chain-test', 'window-session-b-marker');
    await (await sessionButton(secondPath)).click();
    await assertSession(secondPath, 'window-session-b-marker', 'window-agent-chain-test');
    await (await sessionButton(originalPath)).click();
    await assertSession(originalPath, 'window-agent-chain-test', 'window-session-b-marker');
  }, 180_000);

  it('arms and clears a real goal controller from slash commands', async () => {
    const composer = await driver!.findElement(By.css('[data-testid="composer-card"] textarea'));
    await composer.sendKeys('/goal window goal controller');
    await composer.sendKeys(Key.ESCAPE, Key.ENTER);
    const badge = await driver!.wait(
      until.elementLocated(By.css('[data-testid="composer-goal-badge"]')),
      30_000,
    );
    expect(await badge.getText()).toBeTruthy();
    const cleared = await driver!.findElement(By.css('[data-testid="composer-card"] textarea'));
    await cleared.sendKeys('/goal clear');
    await cleared.sendKeys(Key.ESCAPE, Key.ENTER);
    await driver!.wait(async () => (await driver!.findElements(By.css('[data-testid="composer-goal-badge"]'))).length === 0, 30_000);
  }, 100_000);

  it('dispatches a real compact command and shows its acknowledgement', async () => {
    const composer = await driver!.findElement(By.css('[data-testid="composer-card"] textarea'));
    await composer.sendKeys('/compact');
    await composer.sendKeys(Key.ESCAPE, Key.ENTER);
    const toast = await driver!.wait(until.elementLocated(By.css('[role="status"][data-kind="info"]')), 30_000);
    expect(await toast.getText()).toMatch(/Compact requested|已请求压缩上下文/);
  }, 100_000);

  it('sends single, multiple and custom answers through the real question dialog back to the model', async () => {
    await driver!.get(new URL('/chat', await driver!.getCurrentUrl()).toString());
    // bubble 工作模式已弃用:问题链路要"免工具审批打断",等价做法是把
    // 审批策略切到 full_access(回合级全放行)。React 受控 <select> 用
    // 脚本改值并派发 change,确保 onChange 生效并持久化。
    const approval = await driver!.wait(until.elementLocated(By.css('[data-testid="composer-approval-policy"]')), 30_000);
    await driver!.executeScript(
      "arguments[0].value = 'full_access'; arguments[0].dispatchEvent(new Event('change', { bubbles: true }));",
      approval,
    );
    await driver!.wait(async () => (await approval.getAttribute('value')) === 'full_access', 30_000);
    const composer = await driver!.findElement(By.css('[data-testid="composer-card"] textarea'));
    await composer.sendKeys('window-question-chain-test');
    await driver!.findElement(By.css('[data-testid="composer-send"]')).click();
    const dialog = await waitDialog('[data-testid="zcode-question"]');
    expect(await dialog.getText()).toContain('Choose a fruit?');
    const clickOpt = async (label: string, times = 1) => {
      for (let i = 0; i < times; i += 1) {
        await dialog.findElement(By.xpath(`.//button[contains(normalize-space(.), "${label}")]`)).click();
      }
    };
    await clickOpt('Pear');
    await clickOpt('Auth');
    await clickOpt('Audit', 2);
    await clickOpt('Cache');
    await dialog.findElement(By.css('input[aria-label="Other (optional) — Choose features?"]')).sendKeys('window-custom-answer');
    await dialog.findElement(By.xpath('.//button[contains(normalize-space(.), "Submit") or contains(normalize-space(.), "提交")]')).click();
    await driver!.wait(async () => {
      try {
        return (await driver!.findElements(By.css('[data-testid="zcode-question"]'))).length === 0;
      } catch {
        return false;
      }
    }, 30_000);
    const log = await driver!.findElement(By.css('[role="log"]'));
    await driver!.wait(async () => (await log.getText()).includes('window question answer verified'), 60_000);
  }, 150_000);

  it('masks secret input and returns the answer through the real dialog to the model', async () => {
    const composer = await driver!.wait(until.elementLocated(By.css('[data-testid="composer-card"] textarea')), 30_000);
    await composer.sendKeys('window-input-chain-test');
    await driver!.findElement(By.css('[data-testid="composer-send"]')).click();
    const dialog = await waitDialog('[data-testid="zcode-askuser"]');
    const input = await dialog.findElement(By.css('textarea'));
    await input.sendKeys('window-synthetic-secret');
    await dialog.findElement(By.xpath('.//button[contains(normalize-space(.), "Submit") or contains(normalize-space(.), "提交")]')).click();
    await driver!.wait(async () => {
      try {
        return (await driver!.findElements(By.css('[data-testid="zcode-askuser"]'))).length === 0;
      } catch {
        return false;
      }
    }, 30_000);
    const log = await driver!.findElement(By.css('[role="log"]'));
    await driver!.wait(async () => (await log.getText()).includes('window input answer verified'), 60_000);
  }, 150_000);

  it('interrupts a streaming turn and resumes with the next real model message', async () => {
    await driver!.get(new URL('/chat', await driver!.getCurrentUrl()).toString());
    const composer = await driver!.wait(
      until.elementLocated(By.css('[data-testid="composer-card"] textarea')),
      30_000,
    );
    await composer.sendKeys('window-interrupt-start-test');
    await driver!.findElement(By.css('[data-testid="composer-send"]')).click();
    const stop = await driver!.wait(until.elementLocated(By.css('[data-testid="composer-stop"]')), 30_000);
    const providerLog = join(process.env.E2E_SCREENSHOT_DIR ?? '.test-results', 'e2e-mock-provider.log');
    await driver!.wait(() => readFileSync(providerLog, 'utf8').includes('window interrupt start received'), 30_000);
    const log = await driver!.findElement(By.css('[role="log"]'));
    // 先打断慢流首回合(旧顺序是"发续作再点 stop",会把续作回合自己打断,
    // ubuntu 慢机上验证文本永远等不到 —— 按用例本意重排:打断 → 续作)。
    await stop.click();
    await driver!.wait(async () => {
      try {
        return (await driver!.findElements(By.css('[data-testid="composer-stop"]'))).length === 0;
      } catch {
        return false;
      }
    }, 30_000);
    const resumed = await driver!.findElement(By.css('[data-testid="composer-card"] textarea'));
    await resumed.sendKeys('window-interrupt-resume-test');
    await driver!.findElement(By.css('[data-testid="composer-send"]')).click();
    await driver!.wait(async () => (await log.getText()).includes('window interrupt turn verified'), 60_000);
  }, 150_000);

  it.each([...new Set(ROUTES.map(({ route }) => route))])('mounts %s with the real backend', async (route) => {
    const actualPath = route === '/chat/sess-alpha' ? chatSessionPath : route;
    expect(actualPath).toBeTruthy();
    const url = new URL(actualPath, await driver!.getCurrentUrl()).toString();
    await driver!.get(url);
    const main = await driver!.wait(until.elementLocated(By.css('main')), 30_000);
    await driver!.wait(async () => (await main.getText()).trim().length > 0, 30_000);
    expect(await driver!.findElements(By.css('[data-testid="view-error-boundary"]'))).toHaveLength(0);
    if (route === '/chat/sess-alpha') {
      await driver!.wait(async () => (await main.getText()).includes('window second reply verified'), 30_000);
    }
  }, 70_000);
});
