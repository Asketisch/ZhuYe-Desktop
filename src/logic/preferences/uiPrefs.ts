/**
 * uiPrefs —— 顶层 UI 偏好持久化(localStorage)。
 *
 * 所有偏好持久化在同一个 JSON blob(`zhuye.uiprefs.v1`)。
 */
import { useSyncExternalStore } from 'react';

export const DEFAULT_ACCENT_COLOR = '#5dd1c6';

import type { UiPrefs } from '@/contracts/appearance';
export type { UiPrefs } from '@/contracts/appearance';
import { applyPreferencesAppearance, resolveBackground } from '@/logic/webview/appearance';

const DEFAULTS: UiPrefs = {
  reduceTransparency: false,
  chatDiffSplit: false,
  fontScale: 1.0,
  compactDensity: 'comfortable',
  accentColor: DEFAULT_ACCENT_COLOR,
  surfaceOpacity: 1,
  backgroundImage: '',
  backgroundImageOpacity: 0.35,
  activityBarMode: 'simple',
  sendOnEnter: true,
};

const KEY = 'zhuye.uiprefs.v1';
const listeners = new Set<() => void>();
let cached: UiPrefs | null = null;

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function sanitizeImage(value: unknown): string {
  if (typeof value !== 'string') return '';
  const image = value.trim();
  if (!image) return '';
  if (/^(data:image\/|https?:\/\/|asset:|blob:)/i.test(image)) return image;
  return '';
}

function normalize(value: Partial<UiPrefs>): UiPrefs {
  return {
    reduceTransparency: typeof value.reduceTransparency === 'boolean'
      ? value.reduceTransparency
      : DEFAULTS.reduceTransparency,
    chatDiffSplit: typeof value.chatDiffSplit === 'boolean'
      ? value.chatDiffSplit
      : DEFAULTS.chatDiffSplit,
    fontScale: clamp(value.fontScale, 0.85, 1.2, DEFAULTS.fontScale),
    compactDensity: value.compactDensity === 'compact' ? 'compact' : 'comfortable',
    accentColor: isHexColor(value.accentColor) ? value.accentColor.toLowerCase() : DEFAULTS.accentColor,
    surfaceOpacity: clamp(value.surfaceOpacity, 0.5, 1, DEFAULTS.surfaceOpacity),
    backgroundImage: sanitizeImage(value.backgroundImage),
    backgroundImageOpacity: clamp(
      value.backgroundImageOpacity,
      0,
      1,
      DEFAULTS.backgroundImageOpacity,
    ),
    activityBarMode: value.activityBarMode === 'full' ? 'full' : DEFAULTS.activityBarMode,
    sendOnEnter: typeof value.sendOnEnter === 'boolean'
      ? value.sendOnEnter
      : DEFAULTS.sendOnEnter,
  };
}

function load(): UiPrefs {
  if (cached !== null) return cached;
  const fallback: UiPrefs = { ...DEFAULTS };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      cached = normalize(JSON.parse(raw) as Partial<UiPrefs>);
      return cached;
    }
  } catch {
    /* ignore */
  }
  cached = fallback;
  return fallback;
}

function getServerSnapshot(): UiPrefs {
  return DEFAULTS;
}

function persist(next: UiPrefs): void {
  cached = next;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  }
  for (const fn of listeners) fn();
}

export function getUiPrefs(): UiPrefs {
  return load();
}

export function setUiPrefs(patch: Partial<UiPrefs>): void {
  persist(normalize({ ...load(), ...patch }));
}

export function subscribeUiPrefs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useUiPrefs(): [UiPrefs, (patch: Partial<UiPrefs>) => void] {
  const snapshot = useSyncExternalStore(subscribeUiPrefs, load, getServerSnapshot);
  const update = (patch: Partial<UiPrefs>) => setUiPrefs(patch);
  return [snapshot, update];
}

/** 将偏好交给当前外观适配器。 */
export function applyUiPrefs(prefs: UiPrefs): void {
  applyPreferencesAppearance(normalize(prefs));
}

/** 计算当前外观的背景色。 */
export function resolveBodyBackground(prefs: UiPrefs): string {
  return resolveBackground(normalize(prefs));
}

/** 在 bootstrap 时调用一次,然后订阅应用 prefs 变化到 DOM。 */
export function bootstrapUiPrefs(): () => void {
  applyUiPrefs(load());
  return subscribeUiPrefs(() => applyUiPrefs(load()));
}

/** 测试使用：清除模块级快照。 */
export function resetUiPrefsForTests(): void {
  cached = null;
}
