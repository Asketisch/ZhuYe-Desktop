import { afterEach, describe, expect, it } from 'vitest';
import type { Appearance } from '@/contracts/harness/appearance';
import { appearance as defaultAppearance } from '@/render/appearance';
import { getUiPrefs, setUiPrefs } from '@/logic/preferences/uiPrefs';
import { setTheme } from '@/logic/preferences/theme';
import { bootstrapAppearance } from './bootstrapAppearance';
import { setAppearance } from './appearance';

const alternateAppearance: Appearance = {
  backgroundVariable: '--alternate-background', fallbackBackgroundRgb: '1,2,3',
  theme: (mode) => ({ rootData: { alternateTheme: mode }, rootStyle: {}, bodyStyle: {} }),
  preferences: (prefs) => ({ rootData: {}, rootStyle: { '--alternate-scale': String(prefs.fontScale) }, bodyStyle: {} }),
};

afterEach(() => setAppearance(defaultAppearance));

describe('外观适配', () => {
  it('替代外观消费持久化的主题和偏好', () => {
    setUiPrefs({ fontScale: 1.1, sendOnEnter: false });
    const unsubscribe = bootstrapAppearance(alternateAppearance);
    setTheme('light');
    setUiPrefs({ fontScale: 1.2 });
    expect(document.documentElement.dataset.alternateTheme).toBe('light');
    expect(document.documentElement.style.getPropertyValue('--alternate-scale')).toBe('1.2');
    expect(getUiPrefs().sendOnEnter).toBe(false);
    expect(localStorage.getItem('zhuye-theme')).toBe('light');
    unsubscribe();
  });
});
