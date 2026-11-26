import type { Appearance, AppearanceValues, ThemeMode, UiPrefs } from '@/contracts/harness/appearance';

let appearance: Appearance | null = null;
/**
 * 最近一次应用的 UI 偏好。
 *
 * 偏好里的 body 背景色是按**当时**主题的 `--bg-app-rgb` 算出来的，
 * 而它以行内样式写在 <body> 上（行内优先级高于 base.css 的
 * `body { background: var(--bg-app) }`）。主题切换若不重放偏好，
 * body 底色会冻结在切换前的值 —— 会话区（.main 无自身背景）因此
 * 透出旧底色，亮色模式下变成深底深字。
 */
let lastPrefs: UiPrefs | null = null;

/** 设置应用装配时选择的外观映射。 */
export function setAppearance(next: Appearance): void {
  appearance = next;
}

/** 旧入口独立挂载时设置默认映射。 */
export function ensureAppearance(fallback: Appearance): void {
  appearance ??= fallback;
}

function backgroundRgb(): string {
  if (!appearance || typeof document === 'undefined') return appearance?.fallbackBackgroundRgb ?? '';
  return window.getComputedStyle(document.documentElement).getPropertyValue(appearance.backgroundVariable).trim()
    || appearance.fallbackBackgroundRgb;
}

function apply(values: AppearanceValues): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(values.rootData)) {
    if (value === null) delete root.dataset[key];
    else root.dataset[key] = value;
  }
  for (const [key, value] of Object.entries(values.rootStyle)) root.style.setProperty(key, value);
  if (document.body) {
    for (const [key, value] of Object.entries(values.bodyStyle)) document.body.style.setProperty(key, value);
  }
}

export function applyThemeAppearance(mode: ThemeMode): void {
  if (!appearance) return;
  apply(appearance.theme(mode));
  // 主题已翻，backgroundRgb() 此时读到的是**新**主题的 --bg-app-rgb；
  // 重放偏好把 body 底色按新值重算一遍（否则底色冻结在旧主题）。
  if (lastPrefs) apply(appearance.preferences(lastPrefs, backgroundRgb()));
}

export function applyPreferencesAppearance(prefs: UiPrefs): void {
  if (!appearance) return;
  lastPrefs = prefs;
  apply(appearance.preferences(prefs, backgroundRgb()));
}

export function resolveBackground(prefs: UiPrefs): string {
  return appearance?.preferences(prefs, backgroundRgb()).bodyStyle['background-color'] ?? '';
}
