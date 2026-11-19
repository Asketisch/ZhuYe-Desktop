/**
 * i18n 命名空间 —— app.*
 *
 * 由 strings/index.ts merge 进 STRINGS dict；不要直接 import 此模块 ——
 * 走 `@/utils/i18n` 的统一入口。
 */
import type { StringEntry } from '../types';

const app: Record<string, StringEntry> = {
  'app.title':  { en: 'ZhuYe',            'zh-CN': '烛夜' },
  'app.name':   { en: 'ZhuYe',            'zh-CN': '烛夜' },
  'notify.turnFinished': { en: 'Turn finished.', 'zh-CN': '任务已完成。' },
  'notify.approvalBody': {
    en: 'ZhuYe needs your attention (approval / question pending).',
    'zh-CN': '烛夜需要你的处理（有待审批 / 待回答问题）。',
  },
  // ── 浏览器面板(/browser)──
  'browser.title':      { en: 'Browser',                                   'zh-CN': '浏览器' },
  'browser.running':    { en: 'running',                                   'zh-CN': '运行中' },
  'browser.start':      { en: 'Start',                                     'zh-CN': '启动' },
  'browser.stop':       { en: 'Stop',                                      'zh-CN': '停止' },
  'browser.refresh':    { en: 'Refresh',                                   'zh-CN': '刷新' },
  'browser.emptyHint':  { en: 'No live picture yet',                       'zh-CN': '暂无实时画面' },
  'browser.emptySub':   { en: 'Start to launch the controlled browser, or let the agent drive it via the browser plugin.', 'zh-CN': '启动受控浏览器,或让 agent 经 browser 插件驱动页面。' },
};

export default app;
