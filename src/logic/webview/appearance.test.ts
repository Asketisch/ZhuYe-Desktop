/**
 * 外观适配层的主题重放测试。
 *
 * 回归背景：v3 之前 `appearance.preferences()` 把 body 背景色以**行内
 * 样式**写在 <body> 上，而 `appearance.theme()` 的 bodyStyle 为空 ——
 * 主题切换后 body 底色冻结在旧主题的值上；会话区（.main 无自身背景）
 * 透出冻结底色，亮色模式下变成深底深字。
 *
 * 本测试用一份「主题决定背景色」的替身外观复现该语义：不修则主题切换
 * 后 body 底色不变。
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Appearance, ThemeMode, UiPrefs } from '@/contracts/harness/appearance';
import { appearance as defaultAppearance } from '@/render/appearance';
import { applyPreferencesAppearance, applyThemeAppearance, setAppearance } from '@/logic/webview/appearance';

/** 替身外观：body 背景色直接由当前主题决定（复现真实适配层的语义）。 */
function makeThemeDrivenAppearance() {
  let current: ThemeMode = 'dark';
  const adapter: Appearance = {
    backgroundVariable: '--test-bg-rgb',
    fallbackBackgroundRgb: '0,0,0',
    theme: (mode) => {
      current = mode === 'system' ? 'dark' : mode;
      return { rootData: { theme: mode === 'system' ? null : mode }, rootStyle: {}, bodyStyle: {} };
    },
    preferences: () => ({
      rootData: {},
      rootStyle: {},
      bodyStyle: { 'background-color': current === 'light' ? 'rgb(251, 251, 252)' : 'rgb(10, 10, 11)' },
    }),
  };
  return adapter;
}

const PREFS: UiPrefs = {
  reduceTransparency: false,
  chatDiffSplit: false,
  fontScale: 1,
  compactDensity: 'comfortable',
  surfaceOpacity: 1,
  backgroundImage: '',
  backgroundImageOpacity: 0.35,
  activityBarMode: 'simple',
  sendOnEnter: true,
};

afterEach(() => {
  setAppearance(defaultAppearance);
  document.body.style.removeProperty('background-color');
  document.documentElement.removeAttribute('data-theme');
});

describe('外观适配 · 主题切换', () => {
  it('切换主题后 body 背景色随之重算（会话区底色不冻结）', () => {
    setAppearance(makeThemeDrivenAppearance());
    applyPreferencesAppearance(PREFS);
    expect(document.body.style.backgroundColor).toBe('rgb(10, 10, 11)');

    applyThemeAppearance('light');
    expect(document.body.style.backgroundColor).toBe('rgb(251, 251, 252)');

    applyThemeAppearance('dark');
    expect(document.body.style.backgroundColor).toBe('rgb(10, 10, 11)');
  });

  it('重放偏好不会误删 data-theme', () => {
    setAppearance(makeThemeDrivenAppearance());
    applyPreferencesAppearance(PREFS);
    applyThemeAppearance('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('未初始化偏好时切主题不报错（只翻 token）', () => {
    setAppearance(makeThemeDrivenAppearance());
    expect(() => applyThemeAppearance('light')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
