/**
 * i18n 命名空间 —— hooks.*
 *
 * 由 strings/index.ts merge 进 STRINGS dict；不要直接 import 此模块 ——
 * 走 `@/utils/i18n` 的统一入口。
 */
import type { StringEntry } from '../types';

const hooks: Record<string, StringEntry> = {
  'hooks.title':        { en: 'Hooks',                     'zh-CN': 'Hooks' },
  'hooks.subtitle':     { en: 'Enable or disable registered hooks at runtime. Add or edit custom hooks in Settings → Provider ([hooks] section).', 'zh-CN': '运行时启用/停用已注册 hook。新增或编辑自定义 hook 请到 设置 → Provider（[hooks] 段）。' },
  'hooks.enabledCount': { en: '{enabled}/{total} enabled', 'zh-CN': '{enabled}/{total} 已启用' },
  'hooks.on':           { en: 'on',                        'zh-CN': '启用' },
  'hooks.off':          { en: 'off',                       'zh-CN': '停用' },
  'hooks.enable':       { en: 'Enable hook',               'zh-CN': '启用 hook' },
  'hooks.disable':      { en: 'Disable hook',              'zh-CN': '停用 hook' },
  'hooks.loadFailed':   { en: 'Could not load hooks',      'zh-CN': '无法加载 hooks' },
  'hooks.empty':        { en: 'No hooks registered.',      'zh-CN': '没有已注册的 hook。' },
  'hooks.emptyDesc':    { en: 'Built-in hooks appear once the agent thread is installed; custom hooks come from the [hooks] config section.', 'zh-CN': 'agent 线程安装后内置 hook 会出现在这里；自定义 hook 来自 [hooks] 配置段。' },
  'hooks.events.title': { en: 'Hookable events',                                           'zh-CN': '可挂载的事件' },
};

export default hooks;
