/**
 * i18n 命名空间 —— import.*
 *
 * 由 strings/index.ts merge 进 STRINGS dict；不要直接 import 此模块 ——
 * 走 `@/utils/i18n` 的统一入口。
 */
import type { StringEntry } from '../types';

const strings: Record<string, StringEntry> = {
  'import.title':            { en: 'Import sessions',                      'zh-CN': '导入会话' },
  'import.subtitle':         { en: 'Bring sessions from Claude Code / Codex into ZhuYe.', 'zh-CN': '把 Claude Code / Codex 的会话带进烛夜。' },
  'import.kind':             { en: 'Source',                               'zh-CN': '来源' },
  'import.kind.claudeCode':  { en: 'Claude Code',                          'zh-CN': 'Claude Code' },
  'import.kind.codex':       { en: 'Codex',                                'zh-CN': 'Codex' },
  'import.discovered':       { en: 'Discoverable sessions',                'zh-CN': '可导入会话数' },
  'import.discoverFailed':   { en: 'discovery failed',                     'zh-CN': '发现失败' },
  'import.dryRun':           { en: 'Preview only (no files written)',      'zh-CN': '仅预演（不写文件）' },
  'import.preview':          { en: 'Preview import',                       'zh-CN': '预演导入' },
  'import.run':              { en: 'Import',                               'zh-CN': '导入' },
  'import.running':          { en: 'Importing…',                           'zh-CN': '导入中…' },
  'import.hint':             { en: 'Sessions land in the local rollout store and appear in the session list. Single-source failures do not abort the batch.', 'zh-CN': '导入的会话进入本地 rollout 存储，会话列表立即可见。单条失败不会中断整批。' },
  'import.previewTitle':     { en: 'Import preview',                       'zh-CN': '导入预演' },
  'import.resultTitle':      { en: 'Import result',                        'zh-CN': '导入结果' },
  'import.importedCount':    { en: '{count} imported',                     'zh-CN': '已导入 {count} 条' },
  'import.failedCount':      { en: '{count} failed',                       'zh-CN': '失败 {count} 条' },
  'import.turnsUnit':        { en: 'turns',                                'zh-CN': '轮' },
  'import.recordsUnit':      { en: 'records',                              'zh-CN': '条记录' },
  'import.nothingToImport':  { en: 'Nothing to import.',                   'zh-CN': '没有可导入内容。' },
};

export default strings;
