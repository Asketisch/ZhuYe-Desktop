/**
 * i18n 命名空间 —— skills.*
 *
 * 由 strings/index.ts merge 进 STRINGS dict；不要直接 import 此模块 ——
 * 走 `@/utils/i18n` 的统一入口。
 */
import type { StringEntry } from '../types';

const skills: Record<string, StringEntry> = {
  'skills.title':             { en: 'Skills & Tools',                                                           'zh-CN': '技能与工具' },
  'skills.subtitle':          { en: 'Built-in and loaded skills.',                                              'zh-CN': '内置与已加载的技能。' },
  'skills.empty':             { en: 'No skills loaded.',                                                        'zh-CN': '暂无技能。' },
  'skills.builtin':           { en: 'Built-in',                                                                 'zh-CN': '内置' },
  'skills.user':              { en: 'User',                                                                     'zh-CN': '用户' },
  'skills.load':              { en: 'Load',                                                                     'zh-CN': '加载' },
  'skills.unload':            { en: 'Unload',                                                                   'zh-CN': '卸载' },
  'skills.error':             { en: 'Failed to load tools',                                                     'zh-CN': '加载工具失败' },
  'skills.errorDesc':         { en: 'Check the agent backend and try again.',                                   'zh-CN': '请检查 agent 后端并重试。' },
  'skills.toolsCount':        { en: '{count} tool{plural} available. Built-in tools come from reflect-tools;',  'zh-CN': '{count} 个工具可用。内置工具来自 reflect-tools;' },
  'skills.toolsCountSuffix':  { en: '-prefixed tools come from MCP servers.',                                   'zh-CN': '开头的工具来自 MCP 服务。' },
  'skills.mcp':               { en: 'MCP',                                                                      'zh-CN': 'MCP' },
  'skills.noneRegistered':    { en: 'None registered.',                                                         'zh-CN': '尚未注册。' },
  'skills.installed':         { en: 'Installed skills',                                                         'zh-CN': '已安装技能' },
  'skills.installedEmpty':    { en: 'No skills installed. Add SKILL.md folders under ~/.zhuye/skills/.',      'zh-CN': '尚未安装技能。将 SKILL.md 目录放入 ~/.zhuye/skills/ 即可。' },
  'skills.triggers':          { en: 'Triggers',                                                                 'zh-CN': '触发词' },
  'skills.allowedTools':      { en: 'Tools',                                                                    'zh-CN': '允许工具' },
  'skills.bundled':           { en: 'Built-in',                                                                'zh-CN': '内置' },
  'skills.whenPaths':         { en: 'Auto-activate on paths',                                                  'zh-CN': '路径自动激活' },
};

export default skills;
