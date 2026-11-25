import type { Appearance, UiPrefs } from '@/contracts/appearance';

function background(prefs: UiPrefs, rgb: string): string {
  if (prefs.backgroundImage) return 'transparent';
  if (prefs.reduceTransparency || prefs.surfaceOpacity >= 1) return `rgb(${rgb})`;
  return `rgba(${rgb}, ${prefs.surfaceOpacity})`;
}

/** 默认皮肤对主题与用户偏好的映射。 */
export const appearance: Appearance = {
  backgroundVariable: '--bg-app-rgb',
  fallbackBackgroundRgb: '16,16,17',
  theme: (mode) => ({ rootData: { theme: mode === 'system' ? null : mode }, rootStyle: {}, bodyStyle: {} }),
  // 强调色不在这里映射：--accent 及其派生量由 tokens.css 按主题给出，
  // 本文件只负责随偏好变化的量（字号缩放 / 透明度 / 壁纸）。
  preferences: (prefs, backgroundRgb) => {
    return {
      rootData: {
        reduceTransparency: String(prefs.reduceTransparency),
        compactDensity: prefs.compactDensity,
        hasBackgroundImage: String(Boolean(prefs.backgroundImage)),
      },
      rootStyle: {
        '--ds-font-scale': String(prefs.fontScale),
        '--surface-opacity': String(prefs.surfaceOpacity),
        '--background-image': prefs.backgroundImage ? `url(${JSON.stringify(prefs.backgroundImage)})` : 'none',
        '--background-image-opacity': String(prefs.backgroundImageOpacity),
      },
      bodyStyle: {
        'background-color': background(prefs, backgroundRgb),
        '--background-image-opacity': prefs.reduceTransparency || !prefs.backgroundImage ? '0' : String(prefs.backgroundImageOpacity),
      },
    };
  },
};
