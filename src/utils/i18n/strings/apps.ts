/**
 * i18n 命名空间 —— apps.*
 *
 * 由 strings/index.ts merge 进 STRINGS dict；不要直接 import 此模块 ——
 * 走 `@/utils/i18n` 的统一入口。
 */
import type { StringEntry } from '../types';

const apps: Record<string, StringEntry> = {
  'apps.title':        { en: 'Apps',                             'zh-CN': '应用' },
  'apps.subtitle':     { en: 'Connect IDEs and external tools.', 'zh-CN': '连接 IDE 和外部工具。' },
  'apps.empty':        { en: 'No apps loaded.',                  'zh-CN': '暂无应用。' },
  'apps.connected':    { en: 'connected',                        'zh-CN': '已连接' },
  'apps.notConnected': { en: 'Not connected',                    'zh-CN': '未连接' },
  'apps.connect':      { en: 'Connect',                          'zh-CN': '连接' },
  'apps.disconnect':   { en: 'Disconnect',                       'zh-CN': '断开' },
  // v1.11 D10:stub 收口 —— 假 sample 数据改为 coming soon 占位。
  'apps.comingSoonTitle': { en: 'App integrations coming soon',   'zh-CN': '应用集成即将上线' },
  'apps.comingSoonDesc':  { en: 'IDE and external-tool integrations will ship as plugins once the app-plugin runtime lands. Existing plugins keep working via the Plugins view.', 'zh-CN': '应用插件运行时落地后，IDE 与外部工具集成将以插件形式提供。既有插件仍可在「插件」视图使用。' },
};

export default apps;