/** Settings > Display：主题、外观与布局偏好。 */
import { useRef, useState, type CSSProperties } from 'react';
import { Card, Badge, Button, Icon } from '@/features/design-system';
import {
  Image,
  LayoutPanelLeft,
  Minimize2,
  Monitor,
  Moon,
  Palette,
  Sun,
  Type,
} from 'lucide-react';
import { DEFAULT_ACCENT_COLOR, useUiPrefs } from '@/utils/uiPrefs';
import { getTheme, setTheme, type ThemeMode } from '@/utils/theme';
import { useI18n } from '@/utils/i18n';
import s from '../SettingsView.module.css';

const ACCENT_PRESETS = ['#5dd1c6', '#60a5fa', '#a78bfa', '#f472b6', '#fb923c', '#4ade80'];

export function DisplaySection() {
  const [prefs, update] = useUiPrefs();
  const [themeMode, setThemeMode] = useState<ThemeMode>(getTheme);
  const [backgroundUrl, setBackgroundUrl] = useState(prefs.backgroundImage.startsWith('http') ? prefs.backgroundImage : '');
  const [imageError, setImageError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  const chooseTheme = (mode: ThemeMode) => {
    setTheme(mode);
    setThemeMode(mode);
  };

  const loadImage = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setImageError(t('settings.display.backgroundInvalid'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        update({ backgroundImage: String(reader.result ?? '') });
        setImageError('');
      } catch {
        setImageError(t('settings.display.backgroundTooLarge'));
      }
    };
    reader.onerror = () => setImageError(t('settings.display.backgroundInvalid'));
    reader.readAsDataURL(file);
  };

  const applyBackgroundUrl = () => {
    update({ backgroundImage: backgroundUrl });
    setImageError('');
  };

  return (
    <div className={s.displayCards}>
      <Card level="flat" padding="lg">
        <h3 className={s.cardTitle}><Icon icon={Monitor} size={16} /> {t('settings.display.theme')}</h3>
        <p className={s.cardDesc}>{t('settings.display.themeHelp')}</p>
        <div className={s.segmented} role="group" aria-label={t('settings.display.theme')}>
          {([
            ['system', Monitor, 'settings.display.system'],
            ['dark', Moon, 'settings.display.dark'],
            ['light', Sun, 'settings.display.light'],
          ] as const).map(([mode, icon, label]) => (
            <button key={mode} type="button" data-active={themeMode === mode || undefined} onClick={() => chooseTheme(mode)}>
              <Icon icon={icon} size={14} /> {t(label)}
            </button>
          ))}
        </div>
      </Card>

      <Card level="flat" padding="lg">
        <h3 className={s.cardTitle}><Icon icon={Palette} size={16} /> {t('settings.display.accentColor')}</h3>
        <p className={s.cardDesc}>{t('settings.display.accentColorHelp')}</p>
        <div className={s.colorRow}>
          {ACCENT_PRESETS.map((color) => (
            <button
              key={color}
              type="button"
              className={s.colorSwatch}
              data-active={prefs.accentColor === color || undefined}
              style={{ '--swatch-color': color } as CSSProperties}
              aria-label={color}
              onClick={() => update({ accentColor: color })}
            />
          ))}
          <input
            className={s.colorPicker}
            type="color"
            value={prefs.accentColor}
            aria-label={t('settings.display.customAccent')}
            onChange={(event) => update({ accentColor: event.target.value })}
          />
          <code className={s.colorValue}>{prefs.accentColor}</code>
          <Button variant="tertiary" size="sm" onClick={() => update({ accentColor: DEFAULT_ACCENT_COLOR })}>
            {t('common.reset')}
          </Button>
        </div>
      </Card>

      <Card level="flat" padding="lg">
        <h3 className={s.cardTitle}><Icon icon={Minimize2} size={16} /> {t('settings.display.transparency')}</h3>
        <p className={s.cardDesc}>{t('settings.display.transparencyHelp')}</p>
        <label className={s.row}>
          <span>{t('settings.display.surfaceOpacity')}</span>
          <input
            type="range"
            min={50}
            max={100}
            step={1}
            disabled={prefs.reduceTransparency}
            value={Math.round(prefs.surfaceOpacity * 100)}
            onChange={(event) => update({ surfaceOpacity: Number(event.target.value) / 100 })}
          />
          <span className={s.subtle}>{prefs.reduceTransparency ? '100%' : `${Math.round(prefs.surfaceOpacity * 100)}%`}</span>
        </label>
        <label className={s.row}>
          <input type="checkbox" checked={prefs.reduceTransparency} onChange={(event) => update({ reduceTransparency: event.target.checked })} />
          <span>{t('settings.display.reduceTransparency')}</span>
        </label>
      </Card>

      <Card level="flat" padding="lg">
        <h3 className={s.cardTitle}><Icon icon={Image} size={16} /> {t('settings.display.backgroundImage')}</h3>
        <p className={s.cardDesc}>{t('settings.display.backgroundImageHelp')}</p>
        <input ref={fileInput} type="file" accept="image/*" className={s.hiddenInput} onChange={(event) => loadImage(event.target.files?.[0])} />
        <div className={s.backgroundActions}>
          <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>{t('settings.display.chooseImage')}</Button>
          {prefs.backgroundImage && <Button variant="tertiary" size="sm" onClick={() => { update({ backgroundImage: '' }); setBackgroundUrl(''); }}>{t('common.clear')}</Button>}
        </div>
        <div className={s.urlRow}>
          <input type="url" value={backgroundUrl} placeholder="https://…" aria-label={t('settings.display.backgroundUrl')} onChange={(event) => setBackgroundUrl(event.target.value)} />
          <Button variant="tertiary" size="sm" disabled={!backgroundUrl.trim()} onClick={applyBackgroundUrl}>{t('common.apply')}</Button>
        </div>
        {imageError && <p className={s.fieldError}>{imageError}</p>}
        {prefs.backgroundImage && (
          <>
            <div className={s.backgroundPreview} style={{ backgroundImage: `url(${JSON.stringify(prefs.backgroundImage)})` }} />
            <label className={s.row}>
              <span>{t('settings.display.backgroundStrength')}</span>
              <input type="range" min={0} max={100} value={Math.round(prefs.backgroundImageOpacity * 100)} onChange={(event) => update({ backgroundImageOpacity: Number(event.target.value) / 100 })} />
              <span className={s.subtle}>{Math.round(prefs.backgroundImageOpacity * 100)}%</span>
            </label>
          </>
        )}
      </Card>

      <Card level="flat" padding="lg">
        <h3 className={s.cardTitle}><Icon icon={LayoutPanelLeft} size={16} /> {t('settings.display.title')}</h3>
        <p className={s.cardDesc}>{t('settings.display.compactDensityHelp')}</p>
        <label className={s.row}>
          <input type="checkbox" checked={prefs.chatDiffSplit} onChange={(event) => update({ chatDiffSplit: event.target.checked })} />
          <span>{t('settings.display.chatDiffSplit')}</span>
          {prefs.chatDiffSplit && <Badge variant="info">on</Badge>}
        </label>
        <label className={s.row}>
          <span>{t('settings.display.compactDensity')}</span>
          <select value={prefs.compactDensity} onChange={(event) => update({ compactDensity: event.target.value as 'comfortable' | 'compact' })}>
            <option value="comfortable">{t('settings.display.comfortable')}</option>
            <option value="compact">{t('settings.display.compact')}</option>
          </select>
        </label>
        <label className={s.row}>
          <input
            type="checkbox"
            checked={prefs.activityBarMode === 'full'}
            onChange={(event) => update({ activityBarMode: event.target.checked ? 'full' : 'simple' })}
            data-testid="settings-advanced-views"
          />
          <span>{t('settings.display.advancedViews')}</span>
          {prefs.activityBarMode === 'full' && <Badge variant="info">on</Badge>}
        </label>
        <p className={s.subtle}>{t('settings.display.advancedViewsHelp')}</p>
      </Card>

      <Card level="flat" padding="lg">
        <h3 className={s.cardTitle}><Icon icon={Type} size={16} /> {t('settings.display.editor')}</h3>
        <p className={s.cardDesc}>{t('settings.display.sendOnEnterHelp')}</p>
        <label className={s.row}>
          <input
            type="checkbox"
            checked={prefs.sendOnEnter}
            onChange={(event) => update({ sendOnEnter: event.target.checked })}
            data-testid="settings-send-on-enter"
          />
          <span>{t('settings.display.sendOnEnter')}</span>
          {!prefs.sendOnEnter && <Badge variant="info">lock</Badge>}
        </label>
      </Card>

      <Card level="flat" padding="lg">
        <h3 className={s.cardTitle}><Icon icon={Type} size={16} /> {t('settings.display.fontScale')}</h3>
        <p className={s.cardDesc}>{t('settings.display.fontScaleHelp')}</p>
        <label className={s.row}>
          <span>{t('settings.display.fontScale')}</span>
          <input type="range" min={0.85} max={1.2} step={0.05} value={prefs.fontScale} onChange={(event) => update({ fontScale: Number.parseFloat(event.target.value) })} />
          <span className={s.subtle}>{Math.round(prefs.fontScale * 100)}%</span>
        </label>
      </Card>
    </div>
  );
}
