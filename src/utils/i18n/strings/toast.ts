/**
 * i18n 命名空间 —— toast.*
 *
 * 由 strings/index.ts merge 进 STRINGS dict；不要直接 import 此模块 ——
 * 走 `@/utils/i18n` 的统一入口。
 */
import type { StringEntry } from '../types';

const toast: Record<string, StringEntry> = {
  'toast.newSession':         { en: 'New session started.',              'zh-CN': '已开启新会话。' },
  'toast.newSessionFailed':   { en: 'New session failed: {msg}',         'zh-CN': '创建会话失败: {msg}' },
  'toast.workspaceSwitchFailed': { en: 'Workspace switch failed: {msg}', 'zh-CN': '切换工作区失败: {msg}' },
  'toast.noSessionsToClear':  { en: 'No sessions to clear.',             'zh-CN': '没有可清空的会话。' },
  'toast.clearAllTitle':      { en: 'Clear all sessions',                'zh-CN': '清空全部会话' },
  'toast.clearAllConfirm':    { en: 'Delete all {count} sessions and their history files?\nThis cannot be undone.', 'zh-CN': '删除全部 {count} 个会话及其历史文件？\n此操作不可撤销。' },
  'toast.deleteFailed':       { en: 'Delete failed: {msg}',              'zh-CN': '删除失败: {msg}' },
  'toast.listSessionsFailed': { en: 'Unable to load sessions: {msg}',     'zh-CN': '读取会话失败: {msg}' },
  'toast.clearedSessions':    { en: 'Cleared {count} session{plural}.',  'zh-CN': '已清除 {count} 个会话。' },
  'toast.noActiveToExport':   { en: 'No active session to export.',      'zh-CN': '没有可导出的当前会话。' },
  'toast.exportFailed':       { en: 'Export failed: {msg}',              'zh-CN': '导出失败: {msg}' },
  'toast.exportedMarkdown':   { en: 'Exported Markdown → {path}',          'zh-CN': '已导出 Markdown → {path}' },
  'toast.exportedMarkdownNoPath': { en: 'Exported Markdown (no path).',  'zh-CN': '已导出 Markdown(无路径)。' },
  'toast.configReloaded':     { en: 'Config reloaded.',                  'zh-CN': '配置已重载。' },
  'toast.saveFailed':         { en: 'Save failed: {msg}',                'zh-CN': '保存失败: {msg}' },
};

export default toast;
