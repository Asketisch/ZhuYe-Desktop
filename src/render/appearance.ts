import type { Appearance, UiPrefs } from '@/contracts/appearance';

function rgbFromHex(hex: string): [number, number, number] {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
}

function mix(rgb: [number, number, number], target: number, amount: number): string {
  return `#${rgb.map((channel) => Math.round(channel + (target - channel) * amount).toString(16).padStart(2, '0')).join('')}`;
}

function background(prefs: UiPrefs, rgb: string): string {
  if (prefs.backgroundImage) return 'transparent';
  if (prefs.reduceTransparency || prefs.surfaceOpacity >= 1) return `rgb(${rgb})`;
  return `rgba(${rgb}, ${prefs.surfaceOpacity})`;
}

/** 默认皮肤对主题与用户偏好的映射。 */
export const appearance: Appearance = {
  backgroundVariable: '--bg-app-rgb',
  fallbackBackgroundRgb: '11,14,20',
  theme: (mode) => ({ rootData: { theme: mode === 'system' ? null : mode }, rootStyle: {}, bodyStyle: {} }),
  preferences: (prefs, backgroundRgb) => {
    const rgb = rgbFromHex(prefs.accentColor);
    const luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
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
        '--accent': prefs.accentColor,
        '--accent-hover': mix(rgb, 255, 0.16),
        '--accent-active': mix(rgb, 0, 0.12),
        '--accent-subtle': `rgba(${rgb.join(', ')}, 0.14)`,
        '--accent-border': `rgba(${rgb.join(', ')}, 0.38)`,
        '--accent-fg': luminance > 0.58 ? '#07120f' : '#ffffff',
      },
      bodyStyle: {
        'background-color': background(prefs, backgroundRgb),
        '--background-image-opacity': prefs.reduceTransparency || !prefs.backgroundImage ? '0' : String(prefs.backgroundImageOpacity),
      },
    };
  },
};
