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
};

export default app;
