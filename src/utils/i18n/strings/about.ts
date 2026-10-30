/**
 * i18n 命名空间 —— about.*
 *
 * 由 strings/index.ts merge 进 STRINGS dict；不要直接 import 此模块 ——
 * 走 `@/utils/i18n` 的统一入口。
 */
import type { StringEntry } from '../types';

const about: Record<string, StringEntry> = {
  'about.title':                     { en: 'About',                                                                                                                    'zh-CN': '关于' },
  'about.tagline':                   { en: 'Standalone desktop GUI for the ZhuYe agent.',                                                                              'zh-CN': '面向烛夜（ZhuYe agent）的独立桌面 GUI。' },
  'about.version':                   { en: 'Version',                                                                                                                  'zh-CN': '版本' },
  'about.commit':                    { en: 'Commit',                                                                                                                   'zh-CN': 'Commit' },
  'about.buildDate':                 { en: 'Build date',                                                                                                               'zh-CN': '构建时间' },
  'about.website':                   { en: 'Website',                                                                                                                  'zh-CN': '官网' },
  'about.license':                   { en: 'License',                                                                                                                  'zh-CN': '许可证' },
  'about.docs':                      { en: 'Documentation',                                                                                                            'zh-CN': '文档' },
  'about.model':                     { en: 'Model',                                                                                                                    'zh-CN': '模型' },
  'about.workspace':                 { en: 'Workspace',                                                                                                                'zh-CN': '工作区' },
  'about.status':                    { en: 'Status',                                                                                                                   'zh-CN': '状态' },
  'about.ready':                     { en: 'ready',                                                                                                                    'zh-CN': '就绪' },
  'about.degraded':                  { en: 'degraded',                                                                                                                 'zh-CN': '降级' },
  'about.agent':                     { en: 'ZhuYe',                                                                                                                    'zh-CN': '烛夜' },
  'about.agentDesc':                 { en: 'An AI coding agent that helps you write, review, and refactor code. ZhuYe Desktop is the native GUI companion.',           'zh-CN': '帮助你写、审查、重构代码的 AI 编程助手。烛夜桌面端是它的原生 GUI 伴侣。' },
  'about.builtWith':                 { en: 'Built with',                                                                                                               'zh-CN': '技术栈' },
  'about.builtWithDesc':             { en: 'Tauri 2 · React 19 · TanStack Router/Query · Zustand · Vite. The ZhuYe core provides the protocol and tool runtime.',      'zh-CN': 'Tauri 2 · React 19 · TanStack Router/Query · Zustand · Vite。烛夜核心（ZhuYe core）提供协议与工具运行时。' },
  'about.links':                     { en: 'Links',                                                                                                                    'zh-CN': '链接' },
  'about.source':                    { en: 'Source & issues',                                                                                                          'zh-CN': '源码与问题' },
  'about.openSource':                { en: 'Open source',                                                                                                              'zh-CN': '开源' },
  'about.shortcuts':                 { en: 'Keyboard shortcuts',                                                                                                       'zh-CN': '键盘快捷键' },
  'about.shortcut.newSession':       { en: 'New session',                                                                                                              'zh-CN': '新建会话' },
  'about.shortcut.commandPalette':   { en: 'Command palette',                                                                                                          'zh-CN': '命令面板' },
  'about.shortcut.toggleSidebar':    { en: 'Toggle sidebar',                                                                                                           'zh-CN': '切换侧栏' },
  'about.shortcut.toggleInspector':  { en: 'Toggle inspector',                                                                                                         'zh-CN': '切换检查器' },
  'about.shortcut.send':             { en: 'Send message',                                                                                                             'zh-CN': '发送消息' },
  'about.shortcut.focusComposer':    { en: 'Focus composer',                                                                                                           'zh-CN': '聚焦输入框' },
};

export default about;
