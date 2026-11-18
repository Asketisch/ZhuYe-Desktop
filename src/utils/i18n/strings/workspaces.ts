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
  // v1.11 桌面#5:多目录综合工作区。
  'workspaces.additionalDirs':     { en: 'Additional folders',                                   'zh-CN': '附加目录' },
  'workspaces.additionalAdd':      { en: 'Add folder',                                           'zh-CN': '添加目录' },
  'workspaces.additionalPicking':  { en: 'Choose a folder in the dialog…',                       'zh-CN': '在对话框中选择目录…' },
  'workspaces.additionalEmpty':    { en: 'No additional folders. Added folders share one project with the main workspace (tools can read & write them).', 'zh-CN': '尚无附加目录。添加的目录与主工作区合成一个项目(工具可读写)。' },
  'workspaces.additionalAdded':    { en: 'Additional folder added. New sessions pick it up.',    'zh-CN': '附加目录已添加,新会话生效。' },
  'workspaces.additionalFailed':   { en: 'Update additional folders failed: {msg}',              'zh-CN': '更新附加目录失败:{msg}' },
  'workspaces.additionalRemove':   { en: 'Remove additional folder',                             'zh-CN': '移除附加目录' },
  // v1.x 修复:工作区软删除不再被 incidental 切换复活,恢复入口集中在管理页。
  'workspaces.removedTitle':    { en: 'Removed workspaces',                    'zh-CN': '已移除的工作区' },
  'workspaces.restore':         { en: 'Restore',                              'zh-CN': '恢复' },
  'workspaces.removedToast':    { en: 'Removed {name} (files and sessions kept)', 'zh-CN': '已移除 {name}(文件和会话保留)' },
  'workspaces.removeFailed':    { en: 'Failed to remove workspace: {msg}',     'zh-CN': '移除工作区失败: {msg}' },
};

export default workspaces;
