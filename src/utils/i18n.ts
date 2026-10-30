/**
 * i18n —— 烛夜 ZhuYe 全量本地化（英 / 中 双语）。
 *
 * 设计目标：
 *   - 单一来源的 STRINGS 字典（flat key，避免嵌套 key 漂移）。
 *   - 编译期 `LocaleString` 类型 —— 拼错 key 立即报错。
 *   - 自动 fallback：缺中文 → 英文；缺英文 → 返 key。
 *   - `{name}` 占位符 interpolate（仅支持 {key} 简单语法，避免复杂度）。
 *   - `<html lang>` 与 dictation `lang` 跟随 locale 切换。
 *
 * 使用：
 *   const { t, locale } = useI18n();
 *   t('chat.empty.title')                          // 静态
 *   t('chat.viewing', { id: 'abc' })               // 变量插值
 *
 * 模块结构（src/utils/i18n/）：
 *   - types.ts         —— Locale / StringEntry / Strings 类型
 *   - locale.ts        —— DEFAULT_LOCALE / detectLocale / saveLocale /
 *                         resolveLocale / dictationLangFor / STORAGE_KEY
 *   - interpolate.ts   —— {key} 占位符替换
 *   - lookup.ts        —— 静态 t() / pluralize() —— 不依赖 React
 *   - context.tsx      —— I18nProvider / useI18n —— React 集成
 *   - strings/         —— 按 domain namespace 拆分的 catalog 模块,
 *                         由 strings/index.ts merge 成 STRINGS 单一字典。
 *
 * 本文件是兼容性入口 —— 所有现存的
 *   `import { ... } from '@/utils/i18n'`
 * 走这里。
 */
export type { Locale } from './i18n/types';
export type { LocaleKey, StringEntry, Strings } from './i18n/strings';
export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  STORAGE_KEY,
  detectLocale,
  saveLocale,
  resolveLocale,
  dictationLangFor,
} from './i18n/locale';
export { interpolate } from './i18n/interpolate';
export { t, pluralize } from './i18n/lookup';
export { I18nProvider, useI18n } from './i18n/context';
export { STRINGS, ALL_KEYS } from './i18n/strings';