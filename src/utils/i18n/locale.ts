/**
 * i18n locale 解析与持久化。
 *
 * - detectLocale: 启动时读取 localStorage / navigator.language 推断当前 Locale
 * - saveLocale: 切换 locale 时持久化并同步 <html lang>
 * - resolveLocale: 把任意 locale 字符串规范化到受支持的 Locale
 * - dictationLangFor: dictation (Web Speech API) 使用的 BCP-47 lang 字符串
 */
import type { Locale } from './types';

export const DEFAULT_LOCALE: Locale = 'en';
export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'zh-CN'] as const;
export const STORAGE_KEY = 'zhuye.locale';

export function detectLocale(): Locale {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'zh-CN') return stored;
    if (navigator.language.toLowerCase().startsWith('zh')) return 'zh-CN';
  }
  return DEFAULT_LOCALE;
}

export function saveLocale(locale: Locale): void {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.setAttribute('lang', locale);
  }
}

/** 规范化任意 locale 字符串到 app 支持的 Locale。 */
export function resolveLocale(input: string | null | undefined): Locale {
  if (input === 'zh-CN') return 'zh-CN';
  if (input && input.toLowerCase().startsWith('zh')) return 'zh-CN';
  if (input === 'en') return 'en';
  return DEFAULT_LOCALE;
}

/** T(dictation lang) —— 跟 UI locale 同步。 */
export function dictationLangFor(locale: Locale): string {
  return locale === 'zh-CN' ? 'zh-CN' : 'en-US';
}