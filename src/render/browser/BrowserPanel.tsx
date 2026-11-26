import { Globe, Loader2, Monitor, RefreshCw, Square } from 'lucide-react';
import type { BrowserPanelProps } from '@/contracts/workbench/browser';
import { Button } from '../design-system/Button';
import { Icon } from '../design-system/Icon';
import s from './BrowserPanel.module.css';

/** 浏览器面板:受控页面的实时画面(screencast)+ 启停控制。 */
export function BrowserPanel({ t, status, frame, busy, error, onStart, onStop, onRefresh }: BrowserPanelProps) {
  return (
    <div className={s.page} data-testid="browser-panel">
      <div className={s.header}>
        <Icon icon={Globe} size={14} />
        <strong>{t('browser.title')}</strong>
        {status?.running && (
          <span className={s.badge} data-testid="browser-running">
            {t('browser.running')}
          </span>
        )}
        <span className={s.spacer} />
        <Button size="sm" variant="ghost" disabled={busy} onClick={onRefresh} data-testid="browser-refresh">
          <RefreshCw size={12} />
          {t('browser.refresh')}
        </Button>
        {status?.streaming ? (
          <Button size="sm" variant="danger" disabled={busy} onClick={onStop} data-testid="browser-stop">
            {busy ? <Loader2 size={12} className={s.spin} /> : <Square size={12} />}
            {t('browser.stop')}
          </Button>
        ) : (
          <Button size="sm" variant="primary" disabled={busy} onClick={onStart} data-testid="browser-start">
            {busy ? <Loader2 size={12} className={s.spin} /> : <Monitor size={12} />}
            {t('browser.start')}
          </Button>
        )}
      </div>

      {status?.url && (
        <div className={s.urlBar} data-testid="browser-url">
          {status.url}
        </div>
      )}

      {error && (
        <p className={s.error} data-testid="browser-error">
          {error}
        </p>
      )}
      {status?.message && !error && (
        <p className={s.hint} data-testid="browser-message">
          {status.message}
        </p>
      )}

      <div className={s.stage}>
        {frame ? (
          <img className={s.frame} src={frame} alt={status?.title ?? t('browser.title')} data-testid="browser-frame" />
        ) : (
          <div className={s.empty} data-testid="browser-empty">
            <Monitor size={28} />
            <p>{t('browser.emptyHint')}</p>
            <p className={s.emptySub}>{t('browser.emptySub')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
