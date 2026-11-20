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
  'skills.toolsCount':        { en: '{count} tool{plural} available. Built-in tools come from zhuye-tools;',  'zh-CN': '{count} 个工具可用。内置工具来自 zhuye-tools;' },
  'skills.toolsCountSuffix':  { en: '-prefixed tools come from MCP servers.',                                   'zh-CN': '开头的工具来自 MCP 服务。' },
  'skills.mcp':               { en: 'MCP',                                                                      'zh-CN': 'MCP' },
  'skills.noneRegistered':    { en: 'None registered.',                                                         'zh-CN': '尚未注册。' },
  'skills.installed':         { en: 'Installed skills',                                                         'zh-CN': '已安装技能' },
  'skills.installedEmpty':    { en: 'No skills installed. Add SKILL.md folders under ~/.zhuye/skills/.',      'zh-CN': '尚未安装技能。将 SKILL.md 目录放入 ~/.zhuye/skills/ 即可。' },
  'skills.triggers':          { en: 'Triggers',                                                                 'zh-CN': '触发词' },
  'skills.allowedTools':      { en: 'Tools',                                                                    'zh-CN': '允许工具' },
  'skills.bundled':           { en: 'Built-in',                                                                'zh-CN': '内置' },
  'skills.market.title':      { en: 'Skill marketplace',                                                       'zh-CN': '技能市场' },
  'skills.market.desc':       { en: 'Search 2,000+ community skills from skills.sh and install in one click. Installs land in ~/.zhuye/skills/ (multi-file, with bundled scripts) and are picked up without restart.',  'zh-CN': '搜索 skills.sh 的 2000+ 社区技能并一键安装。落到 ~/.zhuye/skills/(整目录含附属脚本),无需重启即生效。' },
  'skills.market.placeholder':{ en: 'owner/repo',                                                              'zh-CN': 'owner/repo' },
  'skills.market.install':    { en: 'Install',                                                                 'zh-CN': '安装' },
  'skills.market.installing': { en: 'Installing…',                                                             'zh-CN': '安装中…' },
  'skills.market.installed':  { en: 'Skill installed from {repo}.',                                            'zh-CN': '已从 {repo} 安装技能。' },
  'skills.market.installFailed': { en: 'Install failed: {msg}',                                                'zh-CN': '安装失败:{msg}' },
  'skills.market.searchPlaceholder': { en: 'Search skills (e.g. react, pdf, find-skills)',                     'zh-CN': '搜索技能(如 react、pdf、find-skills)' },
  'skills.market.official':   { en: 'Official',                                                                'zh-CN': '官方' },
  'skills.market.installedBadge': { en: 'Installed',                                                           'zh-CN': '已装' },
  'skills.market.noResults':  { en: 'No matching skills. Try another keyword.',                               'zh-CN': '没有匹配的技能,换个关键词试试。' },
  'skills.market.refresh':    { en: 'Refresh directory index',                                                'zh-CN': '刷新目录索引' },
  'skills.market.indexRefreshed': { en: 'Directory index refreshed: {count} skills.',                         'zh-CN': '目录索引已刷新:{count} 个技能。' },
  'skills.market.indexFailed':{ en: 'Index refresh failed: {msg}',                                            'zh-CN': '索引刷新失败:{msg}' },
  'skills.market.advanced':   { en: 'Install from GitHub repo',                                               'zh-CN': '从 GitHub 仓库安装' },
  'skills.market.advancedHint': { en: 'Advanced — install by owner/repo (single SKILL.md at repo root):',      'zh-CN': '高级 —— 按 owner/repo 安装(仓库根含单个 SKILL.md):' },
  'skills.sourceAgents':      { en: '.agents/skills',                                                         'zh-CN': '.agents/skills 通用目录' },
  'skills.whenPaths':         { en: 'Auto-activate on paths',                                                  'zh-CN': '路径自动激活' },
};

export default skills;
