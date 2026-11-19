import { useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { useI18n } from '@/utils/i18n';
import { useUiPrefs } from '@/logic/preferences/uiPrefs';
import { getTheme, setTheme, type ThemeMode } from '@/logic/preferences/theme';
import type { SettingsDisplayProps } from '@/contracts/settingsDisplay';
export function DisplayBinding({ view: View }: { view: ComponentType<SettingsDisplayProps> }) {
  const [prefs, update] = useUiPrefs(); const { t } = useI18n();
  const [themeMode, setThemeMode] = useState<ThemeMode>(getTheme);
  const [backgroundUrl, setBackgroundUrl] = useState(prefs.backgroundImage.startsWith('http') ? prefs.backgroundImage : '');
  const [imageError, setImageError] = useState(''); const fileInput = useRef<HTMLInputElement>(null);
  const chooseTheme = (mode: ThemeMode) => { setTheme(mode); setThemeMode(mode); };
  const loadImage = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setImageError(t('settings.display.backgroundInvalid')); return; }
    const reader = new FileReader();
    reader.onload = () => { try { update({ backgroundImage: String(reader.result ?? '') }); setImageError(''); } catch { setImageError(t('settings.display.backgroundTooLarge')); } };
    reader.onerror = () => setImageError(t('settings.display.backgroundInvalid'));
    reader.readAsDataURL(file);
  };
  return <View t={t} prefs={prefs} themeMode={themeMode} backgroundUrl={backgroundUrl} imageError={imageError}
    fileInput={fileInput} onThemeChange={chooseTheme} onUpdate={update}
    onLoadImage={loadImage} onApplyBackgroundUrl={() => { update({ backgroundImage: backgroundUrl }); setImageError(''); }}
    onClearBackground={() => { update({ backgroundImage: '' }); setBackgroundUrl(''); }}
    onBackgroundUrlChange={setBackgroundUrl} />;
}
