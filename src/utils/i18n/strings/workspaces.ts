/**
 * i18n 命名空间 —— workspaces.*
 *
 * 由 strings/index.ts merge 进 STRINGS dict；不要直接 import 此模块 ——
 * 走 `@/utils/i18n` 的统一入口。
 */
import type { StringEntry } from '../types';

const workspaces: Record<string, StringEntry> = {
  'workspaces.title':         { en: 'Workspaces',                                                                                                                  'zh-CN': '工作区' },
  'workspaces.subtitle':      { en: 'Switch projects and configure paths.',                                                                                        'zh-CN': '切换项目并配置路径。' },
  'workspaces.current':       { en: 'Current workspace',                                                                                                           'zh-CN': '当前工作区' },
  'workspaces.switch':        { en: 'Switch',                                                                                                                      'zh-CN': '切换' },
  'workspaces.add':           { en: 'Add workspace',                                                                                                               'zh-CN': '添加工作区' },
  'workspaces.remove':        { en: 'Remove workspace',                                                                                                            'zh-CN': '移除工作区' },
  'workspaces.empty':         { en: 'No workspaces configured.',                                                                                                   'zh-CN': '未配置工作区。' },
  'workspaces.recent':        { en: 'Recent workspaces',                                                                                                           'zh-CN': '最近工作区' },
  'workspaces.note':          { en: 'Switching workspaces here sets the active path for new sessions. Sessions already in flight remain on their original path.',  'zh-CN': '切换工作区会为新会话设置当前路径。已在运行中的会话保留其原路径。' },
  'workspaces.emptyDesc':     { en: 'Start a chat to record your first workspace.',                                                                                'zh-CN': '开启对话来记录你的第一个工作区。' },
  'workspaces.setTo':         { en: 'Workspace set to {name}',                                                                                                     'zh-CN': '工作区已切换到 {name}' },
  'workspaces.loadFailed':    { en: 'Failed to load recent workspaces',                                                                                             'zh-CN': '无法读取最近工作区' },
  'workspaces.switchFailed':  { en: 'Failed to switch workspace: {msg}',                                                                                           'zh-CN': '切换工作区失败: {msg}' },
  'workspaces.use':           { en: 'Use',                                                                                                                         'zh-CN': '使用' },
  'workspaces.sessionCount':  { en: '{count} session{plural}',                                                                                                     'zh-CN': '{count} 个会话' },
  'workspaces.unknown':       { en: '(unknown)',                                                                                                                   'zh-CN': '(未知)' },
  'workspaces.openFolder':    { en: 'Open project folder…',                                                                                                        'zh-CN': '打开项目目录…' },
  'workspaces.pickFailed':    { en: 'Failed to open folder picker: {msg}',                                                                                          'zh-CN': '打开目录选择器失败: {msg}' },
  'workspaces.reveal':        { en: 'Reveal in file manager',                                                                                                       'zh-CN': '在文件管理器中显示' },
  'workspaces.revealFailed':  { en: 'Failed to reveal path: {msg}',                                                                                                'zh-CN': '定位路径失败: {msg}' },
  'workspaces.lastUsed':      { en: 'Last used {time}',                                                                                                             'zh-CN': '最近使用 {time}' },
};

export default workspaces;
