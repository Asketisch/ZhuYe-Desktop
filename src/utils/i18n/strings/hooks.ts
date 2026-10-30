/**
 * i18n 命名空间 —— hooks.*
 *
 * 由 strings/index.ts merge 进 STRINGS dict；不要直接 import 此模块 ——
 * 走 `@/utils/i18n` 的统一入口。
 */
import type { StringEntry } from '../types';

const hooks: Record<string, StringEntry> = {
  'hooks.title':        { en: 'Hooks',                     'zh-CN': 'Hooks' },
  'hooks.subtitle':     { en: 'Enable or disable hooks registered in the current agent.', 'zh-CN': '启用或停用当前 agent 已注册的 hook。' },
  'hooks.enabledCount': { en: '{enabled}/{total} enabled', 'zh-CN': '{enabled}/{total} 已启用' },
  'hooks.on':           { en: 'on',                        'zh-CN': '启用' },
  'hooks.off':          { en: 'off',                       'zh-CN': '停用' },
  'hooks.enable':       { en: 'Enable hook',               'zh-CN': '启用 hook' },
  'hooks.disable':      { en: 'Disable hook',              'zh-CN': '停用 hook' },
  'hooks.loadFailed':   { en: 'Could not load hooks',      'zh-CN': '无法加载 hooks' },
  'hooks.empty':        { en: 'No hooks registered.',      'zh-CN': '没有已注册的 hook。' },
  'hooks.emptyDesc':    { en: 'Enable built-in hooks in settings or load a plugin that registers hooks. Before a session is bound, configuration takes effect when one is opened.', 'zh-CN': '可在设置中启用内置 hook，或加载注册了 hook 的插件。尚未绑定会话时，配置将在打开会话后生效。' },
  'hooks.events.title': { en: 'Hookable events',                                           'zh-CN': '可挂载的事件' },
  'hooks.events.notificationOnly': { en: 'Notification only', 'zh-CN': '仅通知' },
  'hooks.events.failed': { en: 'Failed to load hook events.', 'zh-CN': '加载钩子事件失败。' },
};

export default hooks;
