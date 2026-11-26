export type ThemeMode = 'light' | 'dark' | 'system';

export interface UiPrefs {
  reduceTransparency: boolean;
  chatDiffSplit: boolean;
  fontScale: number;
  compactDensity: 'comfortable' | 'compact';
  surfaceOpacity: number;
  backgroundImage: string;
  backgroundImageOpacity: number;
  activityBarMode: 'simple' | 'full';
  sendOnEnter: boolean;
}

export interface AppearanceValues {
  rootData: Record<string, string | null>;
  rootStyle: Record<string, string>;
  bodyStyle: Record<string, string>;
}

/** 外观将语义偏好转换为当前渲染实现的样式值。 */
export interface Appearance {
  backgroundVariable: string;
  fallbackBackgroundRgb: string;
  theme: (mode: ThemeMode) => AppearanceValues;
  preferences: (prefs: UiPrefs, backgroundRgb: string) => AppearanceValues;
}
