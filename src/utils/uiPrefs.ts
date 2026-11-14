/**
 * uiPrefs —— 顶层 UI 偏好持久化(localStorage)。
 *
 * 所有偏好持久化在同一个 JSON blob(`reflect.uiprefs.v1`)。
 */
import { useSyncExternalStore } from 'react';

export const DEFAULT_ACCENT_COLOR = '#5dd1c6';

export interface UiPrefs {
  reduceTransparency: boolean;
  chatDiffSplit: boolean;
  fontScale: number;
  compactDensity: 'comfortable' | 'compact';
  accentColor: string;
  surfaceOpacity: number;
  backgroundImage: string;
  backgroundImageOpacity: number;
  /** 左侧导航栏模式：simple = 大众默认（少量高频入口 + 「更多」浮层），full = 全部视图平铺。 */
  activityBarMode: 'simple' | 'full';
  /**
   * v1.11 桌面#4：锁定发送 —— `true`（默认）= Enter 发送（旧行为）；
   * `false` = Enter 只换行，发送需 ⌘/Ctrl+Enter 或点按钮（防误发）。
   */
  sendOnEnter: boolean;
}

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

const KEY = 'reflect.uiprefs.v1';
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

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [
    number,
    number,
    number,
  ];
}

function mixChannel(channel: number, target: number, amount: number): number {
  return Math.round(channel + (target - channel) * amount);
}

function rgbHex(rgb: [number, number, number]): string {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function cssUrl(value: string): string {
  return value ? `url(${JSON.stringify(value)})` : 'none';
}

/** 把 prefs apply 到 documentElement 的 dataset + CSS 变量。 */
export function applyUiPrefs(prefs: UiPrefs): void {
  if (typeof document === 'undefined') return;
  const normalized = normalize(prefs);
  const el = document.documentElement;
  const rgb = hexToRgb(normalized.accentColor);
  const luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;

  el.dataset.reduceTransparency = String(normalized.reduceTransparency);
  el.dataset.compactDensity = normalized.compactDensity;
  el.dataset.hasBackgroundImage = String(Boolean(normalized.backgroundImage));
  el.style.setProperty('--ds-font-scale', String(normalized.fontScale));
  el.style.setProperty('--surface-opacity', String(normalized.surfaceOpacity));
  el.style.setProperty('--background-image', cssUrl(normalized.backgroundImage));
  el.style.setProperty('--background-image-opacity', String(normalized.backgroundImageOpacity));
  el.style.setProperty('--accent', normalized.accentColor);
  el.style.setProperty('--accent-hover', rgbHex(rgb.map((v) => mixChannel(v, 255, 0.16)) as [number, number, number]));
  el.style.setProperty('--accent-active', rgbHex(rgb.map((v) => mixChannel(v, 0, 0.12)) as [number, number, number]));
  el.style.setProperty('--accent-subtle', `rgba(${rgb.join(', ')}, 0.14)`);
  el.style.setProperty('--accent-border', `rgba(${rgb.join(', ')}, 0.38)`);
  el.style.setProperty('--accent-fg', luminance > 0.58 ? '#07120f' : '#ffffff');

  // 把 body 背景直接解析成字面量写入 body.style.backgroundColor：
  //   - 让 var(--bg-app-alpha) / reduceTransparency 覆盖在 jsdom 也可解算。
  //   - 真机渲染仍由 tokens.css 决定，body.style 只用于 PR 测试可见与冲突 fallback。
  const body = el.ownerDocument?.body;
  if (body) {
    body.style.backgroundColor = resolveBodyBackground(normalized);
    // 同时把 ::before 的 opacity 写成字面量（同样为 jsdom 友好）：
    body.style.setProperty(
      '--background-image-opacity',
      normalized.reduceTransparency || !normalized.backgroundImage ? '0' : String(normalized.backgroundImageOpacity),
    );
  }
}

/**
 * 把 prefs 解析成 body 的最终背景色字面量。
 *
 * - 背景图存在时返回 `'transparent'`（让 body::before 透出底色）。
 * - reduceTransparency 打开时返回纯 `rgb(R, G, B)`（alpha=1 全不透明）。
 * - 否则返回 `rgba(R, G, B, A)` 直接带 alpha 通道，可被 jsdom 解析。
 *
 * 默认深色 RGB 三元组来自 `tokens.css` 的 `--bg-app-rgb`。
 */
export function resolveBodyBackground(prefs: UiPrefs): string {
  const normalized = normalize(prefs);
  const rgb = readActiveBgRgb();
  if (normalized.backgroundImage) return 'transparent';
  if (normalized.reduceTransparency || normalized.surfaceOpacity >= 1) {
    return `rgb(${rgb})`;
  }
  return `rgba(${rgb}, ${normalized.surfaceOpacity})`;
}

/**
 * 读取当前激活主题（`tokens.css` 中定义的 `--bg-app-rgb`）
 * 当 `--bg-app-rgb` 未声明时回退到深色默认 `#0b0e14` 的三元组。
 */
function readActiveBgRgb(): string {
  if (typeof document === 'undefined') return '11,14,20';
  const fromRoot = window.getComputedStyle(document.documentElement)
    .getPropertyValue('--bg-app-rgb')
    .trim();
  if (fromRoot) return fromRoot;
  return '11,14,20';
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
