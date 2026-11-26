import type { Appearance } from '@/contracts/harness/appearance';
import { initTheme } from '@/logic/preferences/theme';
import { bootstrapUiPrefs } from '@/logic/preferences/uiPrefs';
import { setAppearance } from './appearance';

/** 初始化所选外观并订阅持久化偏好变化。 */
export function bootstrapAppearance(appearance: Appearance): () => void {
  setAppearance(appearance);
  const stopTheme = initTheme();
  const stopPrefs = bootstrapUiPrefs();
  return () => { stopTheme(); stopPrefs(); };
}
