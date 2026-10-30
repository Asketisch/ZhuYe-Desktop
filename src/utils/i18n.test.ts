/**
 * Vitest — i18n 测试。
 *
 * 覆盖：
 *   - 默认 locale 与 fallback 行为
 *   - zh-CN / en 双向 lookup
 *   - interpolate `{name}` 占位符
 *   - pluralize 中文 consistent / 英文 +s
 *   - catalog parity: 所有 keys 在 en 与 zh-CN 都存在
 *   - resolveLocale / dictationLangFor / saveLocale
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  t,
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  ALL_KEYS,
  STRINGS,
  interpolate,
  resolveLocale,
  dictationLangFor,
  saveLocale,
  pluralize,
  type Locale,
  type LocaleKey,
} from '@/utils/i18n';

describe('t()', () => {
  it('DEFAULT_LOCALE is en (UI 主体语言)', () => {
    expect(DEFAULT_LOCALE).toBe('en');
  });

  it('returns English by default', () => {
    expect(t('app.title')).toBe('ZhuYe');
    expect(t('sidebar.sessions')).toBe('Sessions');
  });

  it('returns zh-CN when explicitly requested', () => {
    const zh: Locale = 'zh-CN';
    expect(t('sidebar.sessions', zh)).toBe('会话');
    expect(t('sidebar.refresh', zh)).toBe('刷新');
  });

  it('returns English when locale=en', () => {
    expect(t('sidebar.sessions', 'en')).toBe('Sessions');
    expect(t('sidebar.loading', 'en')).toBe('Loading…');
  });

  it('returns key as fallback for unknown keys', () => {
    expect(t('nonexistent.key', 'en')).toBe('nonexistent.key');
  });

  it('composer/chat empty strings are present in both locales', () => {
    expect(t('composer.placeholder', 'en')).toContain('Ask ZhuYe');
    expect(t('composer.placeholder', 'zh-CN')).toContain('烛夜');
    expect(t('chat.empty.title', 'en')).toBe('Start a conversation');
    expect(t('chat.empty.title', 'zh-CN')).toBe('开始一次对话');
  });

  it('interpolate {name} 占位符', () => {
    expect(t('shell.status.ready', 'en', { model: 'claude-3-5' })).toBe('Agent ready — model claude-3-5');
    expect(t('shell.status.ready', 'zh-CN', { model: 'claude-3-5' })).toBe('Agent 就绪 — 模型 claude-3-5');
    expect(t('composer.exported', 'en', { path: '/tmp/x.json' })).toBe('Exported → /tmp/x.json');
  });

  it('interpolate 缺变量保留 placeholder', () => {
    expect(t('shell.status.ready', 'en')).toContain('{model}');
  });

  it('interpolate 多个变量', () => {
    expect(t('shell.mcpLspFailed', 'en', { mcp: 2, lsp: 1 })).toBe('2 MCP / 1 LSP failed');
    expect(t('shell.mcpLspFailed', 'zh-CN', { mcp: 2, lsp: 1 })).toBe('2 个 MCP / 1 个 LSP 失败');
  });
});

describe('pluralize()', () => {
  it('英文 count=1 不加 s', () => {
    expect(pluralize('toast.clearedSessions', 'en', 1)).toBe('Cleared 1 session.');
  });
  it('英文 count>1 加 s', () => {
    expect(pluralize('toast.clearedSessions', 'en', 3)).toBe('Cleared 3 sessions.');
  });
  it('中文无论 count 都不加 s', () => {
    expect(pluralize('toast.clearedSessions', 'zh-CN', 1)).toBe('已清除 1 个会话。');
    expect(pluralize('toast.clearedSessions', 'zh-CN', 5)).toBe('已清除 5 个会话。');
  });
});

describe('interpolate()', () => {
  it('替换 {key} 占位符', () => {
    expect(interpolate('hello {name}', { name: 'world' })).toBe('hello world');
  });
  it('无 vars 时原样返回', () => {
    expect(interpolate('hello {name}')).toBe('hello {name}');
  });
  it('缺值保留 placeholder', () => {
    expect(interpolate('hello {name}', { foo: 'bar' })).toBe('hello {name}');
  });
  it('数字变量', () => {
    expect(interpolate('{n} sessions', { n: 3 })).toBe('3 sessions');
  });
});

describe('catalog parity', () => {
  it('SUPPORTED_LOCALES = [en, zh-CN]', () => {
    expect(SUPPORTED_LOCALES).toEqual(['en', 'zh-CN']);
  });

  it('ALL_KEYS 至少 200 keys', () => {
    expect(ALL_KEYS.length).toBeGreaterThanOrEqual(200);
  });

  it('每个 key 都有 en + zh-CN 翻译', () => {
    for (const key of ALL_KEYS) {
      const entry = STRINGS[key];
      expect(entry, `missing entry for ${key}`).toBeDefined();
      expect(typeof entry.en, `missing en for ${key}`).toBe('string');
      expect(typeof entry['zh-CN'], `missing zh-CN for ${key}`).toBe('string');
      expect(entry.en.length, `empty en for ${key}`).toBeGreaterThan(0);
      expect(entry['zh-CN'].length, `empty zh-CN for ${key}`).toBeGreaterThan(0);
    }
  });

  it('locale key 至少覆盖 11 个命名空间', () => {
    const namespaces = new Set<string>();
    for (const k of ALL_KEYS) {
      const ns = k.split('.')[0];
      if (ns) namespaces.add(ns);
    }
    expect(namespaces.size).toBeGreaterThanOrEqual(11);
  });
});

describe('resolveLocale()', () => {
  it('zh-CN 标准化', () => {
    expect(resolveLocale('zh-CN')).toBe('zh-CN');
    expect(resolveLocale('zh')).toBe('zh-CN');
    expect(resolveLocale('zh-TW')).toBe('zh-CN');
    expect(resolveLocale('zh-Hans')).toBe('zh-CN');
  });
  it('en 标准化', () => {
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('en-US')).toBe('en');
    expect(resolveLocale('en-GB')).toBe('en');
  });
  it('unknown → default', () => {
    expect(resolveLocale(null)).toBe('en');
    expect(resolveLocale(undefined)).toBe('en');
    expect(resolveLocale('')).toBe('en');
    expect(resolveLocale('fr')).toBe('en');
  });
});

describe('dictationLangFor()', () => {
  it('zh-CN → zh-CN', () => {
    expect(dictationLangFor('zh-CN')).toBe('zh-CN');
  });
  it('en → en-US', () => {
    expect(dictationLangFor('en')).toBe('en-US');
  });
});

describe('saveLocale()', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('lang');
  });

  it('写入 localStorage 与 <html lang>', () => {
    saveLocale('zh-CN');
    expect(window.localStorage.getItem('reflect.locale')).toBe('zh-CN');
    expect(document.documentElement.getAttribute('lang')).toBe('zh-CN');
  });

  it('en 写 en', () => {
    saveLocale('en');
    expect(window.localStorage.getItem('reflect.locale')).toBe('en');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
  });
});

describe('typed key safety', () => {
  it('LocaleKey 是字符串字面量 union', () => {
    const k: LocaleKey = 'app.title';
    expect(typeof k).toBe('string');
  });
});
