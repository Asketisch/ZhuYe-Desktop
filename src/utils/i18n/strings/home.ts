/**
 * i18n 命名空间 —— home.*
 *
 * 由 strings/index.ts merge 进 STRINGS dict；不要直接 import 此模块 ——
 * 走 `@/utils/i18n` 的统一入口。
 */
import type { StringEntry } from '../types';

const home: Record<string, StringEntry> = {
  'home.title':                    { en: 'Home',                                                                   'zh-CN': '首页' },
  'home.subtitle':                 { en: 'Welcome to ZhuYe.',                                                      'zh-CN': '欢迎使用烛夜。' },
  'home.startNew':                 { en: 'Start a new chat',                                                       'zh-CN': '开启新对话' },
  'home.openRecent':               { en: 'Open recent',                                                            'zh-CN': '打开最近' },
  'home.noRecent':                 { en: 'No recent sessions yet.',                                                'zh-CN': '暂无最近会话。' },
  'home.shortcut.newSession':      { en: 'New session — ⌘N',                                                       'zh-CN': '新建会话 — ⌘N' },
  'home.shortcut.commandPalette':  { en: 'Command palette — ⌘K',                                                   'zh-CN': '命令面板 — ⌘K' },
  'home.active':                   { en: 'active',                                                                 'zh-CN': '活跃' },
  'home.quickStart':               { en: 'Quick start',                                                            'zh-CN': '快速开始' },
  'home.recentSessions':           { en: 'Recent sessions',                                                        'zh-CN': '最近会话' },
  'home.viewAll':                  { en: 'View all',                                                               'zh-CN': '查看全部' },
  'home.startNewDesc':             { en: 'Start a fresh conversation',                                             'zh-CN': '开启新对话' },
  'home.workspacesDesc':           { en: 'Recent project directories',                                             'zh-CN': '最近的项目目录' },
  'home.modelsDesc':               { en: 'Switch model or effort',                                                 'zh-CN': '切换模型或 effort' },
  'home.settingsDesc':             { en: 'Provider & permissions',                                                 'zh-CN': '提供商与权限' },
  'home.startNewSession':          { en: 'Start a chat to create your first session.',                             'zh-CN': '开启第一次对话来创建你的第一个会话。' },
  'home.welcomeTitle':             { en: 'Welcome to ZhuYe',                                                       'zh-CN': '欢迎使用烛夜' },
  'home.welcomeDesc':              { en: 'AI coding agent — start a conversation or pick up where you left off.',  'zh-CN': 'AI 编程助手——开启对话或继续上次的工作。' },
};

export default home;
