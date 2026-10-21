/**
 * i18n 命名空间 —— memory.*
 *
 * 由 strings/index.ts merge 进 STRINGS dict；不要直接 import 此模块 ——
 * 走 `@/utils/i18n` 的统一入口。
 */
import type { StringEntry } from '../types';

const memory: Record<string, StringEntry> = {
  'memory.title':          { en: 'Memory',                    'zh-CN': '记忆' },
  'memory.subtitle':       { en: 'Persistent key-value memory across sessions, scoped by context.', 'zh-CN': '跨会话持久化键值记忆，按上下文分范围。' },
  'memory.scope.all':      { en: 'All',                       'zh-CN': '全部' },
  'memory.scope.user':     { en: 'User',                      'zh-CN': '用户' },
  'memory.scope.project':  { en: 'Project',                   'zh-CN': '项目' },
  'memory.scope.session':  { en: 'Session',                   'zh-CN': '会话' },
  'memory.scope.userCap':  { en: 'User',                      'zh-CN': '用户' },
  'memory.scope.projectCap': { en: 'Project',                 'zh-CN': '项目' },
  'memory.empty':          { en: 'No memory entries',         'zh-CN': '暂无记忆' },
  'memory.emptyDesc':      { en: 'Add a key above or let the agent learn your preferences through chat.', 'zh-CN': '在上方添加键值，或通过对话让 agent 学习偏好。' },
  'memory.failed':         { en: 'Failed to load memory',     'zh-CN': '加载记忆失败' },
  'memory.failedDesc':     { en: 'Check the agent backend and try again.', 'zh-CN': '检查后端并重试。' },
  'memory.add':            { en: 'Add',                       'zh-CN': '添加' },
  'memory.cancel':         { en: 'Cancel',                    'zh-CN': '取消' },
  'memory.edit':           { en: 'Edit',                      'zh-CN': '编辑' },
  'memory.delete':         { en: 'Delete',                    'zh-CN': '删除' },
  'memory.save':           { en: 'Save',                      'zh-CN': '保存' },
  'memory.key':            { en: 'Key (e.g. preference)',     'zh-CN': '键 (例如 preference)' },
  'memory.value':          { en: 'Value',                     'zh-CN': '值' },
  'memory.scope':          { en: 'Scope',                     'zh-CN': '范围' },
  'memory.toast.added':    { en: 'Added {key}',               'zh-CN': '已添加 {key}' },
  'memory.toast.removed':  { en: 'Removed {key}',             'zh-CN': '已移除 {key}' },
  'memory.toast.updated':  { en: 'Updated {key}',             'zh-CN': '已更新 {key}' },
  'memory.toast.addFail':  { en: 'Add failed: {msg}',         'zh-CN': '添加失败：{msg}' },
  'memory.toast.removeFail': { en: 'Remove failed: {msg}',    'zh-CN': '移除失败：{msg}' },
  'memory.toast.updateFail': { en: 'Update failed: {msg}',    'zh-CN': '更新失败：{msg}' },
  'memory.toast.keyRequired': { en: 'Key is required.',       'zh-CN': '键不能为空。' },
  // 会话笔记(agent 写下的持久结论)
  'notes.title':            { en: 'Session notes',                  'zh-CN': '会话笔记' },
  'notes.empty':           { en: 'No session notes',               'zh-CN': '暂无会话笔记' },
  'notes.emptyHint':       { en: 'Notes the agent records during a session appear here.', 'zh-CN': 'agent 在会话中记下的结论会显示在这里。' },
  'notes.pickSession':     { en: 'Pick a session',                  'zh-CN': '选择会话' },
  'notes.currentSession':  { en: 'Current session',                 'zh-CN': '当前会话' },
  // 记忆作用域提示(核心按 agent 显式启用记忆)
  'memory.scopeNotDeclared': { en: 'Agent “{agent}” declares no memory scope, so entries here are not injected into the prompt. Add memory = ["project", "user"] to its definition in Agents.', 'zh-CN': '当前 agent「{agent}」未声明记忆作用域,这里写的内容不会被注入 prompt。可在 Agents 里给它的定义加上 memory = ["project", "user"]。' },
  // 记忆分段(agent 实际注入的结构)
  'memory.sections.title':  { en: 'Memory sections',                   'zh-CN': '记忆分段' },
  'memory.sections.budget': { en: '{used} / {total} chars injected',  'zh-CN': '注入 {used} / {total} 字符' },
};

export default memory;