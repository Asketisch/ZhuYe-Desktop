/**
 * i18n 命名空间 —— preview.*
 *
 * 由 strings/index.ts merge 进 STRINGS dict；不要直接 import 此模块 ——
 * 走 `@/utils/i18n` 的统一入口。
 */
import type { StringEntry } from '../types';

const strings: Record<string, StringEntry> = {
  'preview.title':          { en: 'HTML preview',                                                'zh-CN': 'HTML 预览' },
  'preview.subtitle':       { en: 'Preview HTML artifacts the agent generates, without leaving the app.', 'zh-CN': '直接预览 agent 生成的 HTML 产物，无需离开应用。' },
  'preview.placeholder':    { en: 'Relative path, e.g. dist/index.html',                        'zh-CN': '相对路径，如 dist/index.html' },
  'preview.pathLabel':      { en: 'HTML file path',                                             'zh-CN': 'HTML 文件路径' },
  'preview.open':           { en: 'Open',                                                       'zh-CN': '打开' },
  'preview.workspaceHint':  { en: 'Resolved against workspace:',                                'zh-CN': '相对当前工作区解析：' },
  'preview.readFailed':     { en: 'read failed (missing file or outside workspace)',            'zh-CN': '读取失败（文件不存在或越界）' },
  'preview.rawFallback':    { en: 'Not an .html file — showing raw text',                       'zh-CN': '非 .html 文件 —— 以纯文本展示' },
};

export default strings;
