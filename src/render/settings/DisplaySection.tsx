import { Image, LayoutPanelLeft, Minimize2, Monitor, Moon, Sun } from 'lucide-react';
import type { SettingsDisplayProps } from '@/contracts/settingsDisplay';
import { GroupCard, Row, SubHead, Select } from './settingsKit';
import kit from './SettingsPage.module.css';

/**
 * DisplaySection —— 外观分区（纯展示）。
 *
 * 视觉走设置页套件：SubHead 小节头 + GroupCard 行卡 + Row（左文案右控件）。
 * 测试锚点（h3 标题 / slider 可及名 / checkbox testid）全部保留。
 */
export function DisplaySection({ t, prefs, themeMode, backgroundUrl, imageError, fileInput,
  onThemeChange, onUpdate, onLoadImage, onApplyBackgroundUrl, onClearBackground, onBackgroundUrlChange }: SettingsDisplayProps) {
  return (
    <div className={kit.secBody}>
      <SubHead title={<><Monitor size={16} strokeWidth={1.5} aria-hidden /> {t('settings.display.theme')}</>} description={t('settings.display.themeHelp')} />
      <GroupCard>
        <Row label={t('settings.display.theme')} wide>
          <span className={kit.seg} role="group" aria-label={t('settings.display.theme')}>
            {([
              ['system', Monitor, 'settings.display.system'],
              ['dark', Moon, 'settings.display.dark'],
              ['light', Sun, 'settings.display.light'],
            ] as const).map(([mode, icon, label]) => {
              const IconComp = icon;
              return (
                <button
                  key={mode}
                  type="button"
                  className={kit.segBtn}
                  data-active={themeMode === mode || undefined}
                  aria-pressed={themeMode === mode}
                  onClick={() => onThemeChange(mode)}
                >
                  <IconComp size={14} strokeWidth={1.5} aria-hidden /> {t(label)}
                </button>
              );
            })}
          </span>
        </Row>
        <Row label={t('settings.display.fontScale')} description={t('settings.display.fontScaleHelp')}>
          <span className={kit.rangeCtl}>
            <input
              type="range"
              min={0.85}
              max={1.2}
              step={0.05}
              value={prefs.fontScale}
              aria-label={t('settings.display.fontScale')}
              onChange={(event) => onUpdate({ fontScale: Number.parseFloat(event.target.value) })}
            />
            <span className={kit.rangeVal}>{Math.round(prefs.fontScale * 100)}%</span>
          </span>
        </Row>
        <Row label={t('settings.display.compactDensity')}>
          <Select
            value={prefs.compactDensity}
            ariaLabel={t('settings.display.compactDensity')}
            onChange={(v) => onUpdate({ compactDensity: v as 'comfortable' | 'compact' })}
            options={[
              { value: 'comfortable', label: t('settings.display.comfortable') },
              { value: 'compact', label: t('settings.display.compact') },
            ]}
          />
        </Row>
      </GroupCard>

      <SubHead title={<><Minimize2 size={16} strokeWidth={1.5} aria-hidden /> {t('settings.display.transparency')}</>} description={t('settings.display.transparencyHelp')} />
      <GroupCard>
        <Row label={t('settings.display.surfaceOpacity')}>
          <span className={kit.rangeCtl}>
            <input
              type="range"
              min={50}
              max={100}
              step={1}
              disabled={prefs.reduceTransparency}
              value={Math.round(prefs.surfaceOpacity * 100)}
              aria-label={t('settings.display.surfaceOpacity')}
              onChange={(event) => onUpdate({ surfaceOpacity: Number(event.target.value) / 100 })}
            />
            <span className={kit.rangeVal}>{prefs.reduceTransparency ? '100%' : `${Math.round(prefs.surfaceOpacity * 100)}%`}</span>
          </span>
        </Row>
        <Row label={t('settings.display.reduceTransparency')}>
          <input
            type="checkbox"
            className={kit.checkbox}
            checked={prefs.reduceTransparency}
            aria-label={t('settings.display.reduceTransparency')}
            onChange={(event) => onUpdate({ reduceTransparency: event.target.checked })}
          />
        </Row>
      </GroupCard>

      <SubHead title={<><Image size={16} strokeWidth={1.5} aria-hidden /> {t('settings.display.backgroundImage')}</>} description={t('settings.display.backgroundImageHelp')} />
      <GroupCard>
        <Row label={t('settings.display.chooseImage')}>
          <input ref={fileInput} type="file" accept="image/*" className={kit.hiddenInput} onChange={(event) => onLoadImage(event.target.files?.[0])} />
          <button type="button" className={kit.btn} onClick={() => fileInput.current?.click()}>{t('settings.display.chooseImage')}</button>
          {prefs.backgroundImage && (
            <button type="button" className={kit.btn} onClick={onClearBackground}>{t('common.clear')}</button>
          )}
        </Row>
        <Row label={t('settings.display.backgroundUrl')} detail={(
          <div className={kit.urlRow}>
            <input
              type="url"
              className={kit.input}
              value={backgroundUrl}
              placeholder="https://…"
              aria-label={t('settings.display.backgroundUrl')}
              onChange={(event) => onBackgroundUrlChange(event.target.value)}
            />
            <button
              type="button"
              className={`${kit.btn} ${kit.outline}`}
              disabled={!backgroundUrl.trim()}
              onClick={onApplyBackgroundUrl}
            >
              {t('common.apply')}
            </button>
          </div>
        )}>
          <span />
        </Row>
        {imageError ? <div className={kit.notice}><span>{imageError}</span></div> : null}
        {prefs.backgroundImage && (
          <Row label={t('settings.display.backgroundStrength')}>
            <span className={kit.rangeCtl}>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(prefs.backgroundImageOpacity * 100)}
                aria-label={t('settings.display.backgroundStrength')}
                onChange={(event) => onUpdate({ backgroundImageOpacity: Number(event.target.value) / 100 })}
              />
              <span className={kit.rangeVal}>{Math.round(prefs.backgroundImageOpacity * 100)}%</span>
            </span>
          </Row>
        )}
        {prefs.backgroundImage && (
          <div className={kit.row}>
            <div className={kit.backgroundPreview} style={{ backgroundImage: `url(${JSON.stringify(prefs.backgroundImage)})` }} />
          </div>
        )}
      </GroupCard>

      <SubHead title={<><LayoutPanelLeft size={16} strokeWidth={1.5} aria-hidden /> {t('settings.display.title')}</>} description={t('settings.display.compactDensityHelp')} />
      <GroupCard>
        <Row label={t('settings.display.chatDiffSplit')}>
          <span className={kit.rowCtl}>
            <input
              type="checkbox"
              className={kit.checkbox}
              checked={prefs.chatDiffSplit}
              aria-label={t('settings.display.chatDiffSplit')}
              onChange={(event) => onUpdate({ chatDiffSplit: event.target.checked })}
            />
            {prefs.chatDiffSplit ? <span className={kit.badge}>on</span> : null}
          </span>
        </Row>
        <Row label={t('settings.display.advancedViews')} description={t('settings.display.advancedViewsHelp')}>
          <span className={kit.rowCtl}>
            <input
              type="checkbox"
              className={kit.checkbox}
              checked={prefs.activityBarMode === 'full'}
              aria-label={t('settings.display.advancedViews')}
              onChange={(event) => onUpdate({ activityBarMode: event.target.checked ? 'full' : 'simple' })}
              data-testid="settings-advanced-views"
            />
            {prefs.activityBarMode === 'full' ? <span className={kit.badge}>on</span> : null}
          </span>
        </Row>
        <Row label={t('settings.display.sendOnEnter')} description={t('settings.display.sendOnEnterHelp')}>
          <span className={kit.rowCtl}>
            <input
              type="checkbox"
              className={kit.checkbox}
              checked={prefs.sendOnEnter}
              aria-label={t('settings.display.sendOnEnter')}
              onChange={(event) => onUpdate({ sendOnEnter: event.target.checked })}
              data-testid="settings-send-on-enter"
            />
            {!prefs.sendOnEnter ? <span className={kit.badge}>lock</span> : null}
          </span>
        </Row>
      </GroupCard>
    </div>
  );
}
