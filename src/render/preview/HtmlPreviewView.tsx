import { FileCode2 } from 'lucide-react';
import { PageShell } from '../shell/PageShell';
import { Card } from '../design-system/Card';
import { Badge } from '../design-system/Badge';
import { Button } from '../design-system/Button';
import { Input } from '../design-system/Input';
import type { HtmlPreviewProps } from '@/contracts/workbench/htmlPreview';
import s from './HtmlPreviewView.module.css';

export function HtmlPreviewView({ t, relPath, onPathChange, onOpen, disabled, workspace, content, isHtml, loading, error, ports }: HtmlPreviewProps) {
  return (
    <PageShell icon={FileCode2} title={t('preview.title')} subtitle={t('preview.subtitle')} width="lg">
      <Card level="flat" padding="lg">
        <div className={s.row}>
          <Input value={relPath} onChange={(e) => onPathChange(e.target.value)} placeholder={t('preview.placeholder')} aria-label={t('preview.pathLabel')} data-testid="preview-path-input" onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }} />
          <Button variant="primary" size="sm" disabled={disabled} onClick={onOpen} data-testid="preview-open-btn">{t('preview.open')}</Button>
        </div>
        <p className={s.hint}>{t('preview.workspaceHint')} <code>{workspace ?? '…'}</code></p>
        {error && <Badge variant="warning" data-testid="preview-error">{t('preview.readFailed')}</Badge>}
        {loading && <Badge variant="neutral">{t('common.loading')}</Badge>}
        <div className={s.livePorts} data-testid="preview-live-ports">
          <span className={s.liveTitle}>{t('preview.livePorts.title')}</span>
          {ports.filter((p) => p.open).length > 0 ? ports.filter((p) => p.open).map((p) => (
            <a key={p.port} href={p.url} target="_blank" rel="noreferrer" className={s.liveLink} data-testid={`preview-live-${p.port}`}>{p.url}</a>
          )) : <span className={s.liveNone}>{t('preview.livePorts.none')}</span>}
        </div>
      </Card>
      {content && (
        <Card level="flat" padding="none" className={s.frameCard}>
          <iframe title={t('preview.title')} className={s.frame} sandbox="" srcDoc={content} data-testid="preview-frame" />
          {!isHtml && <div className={s.rawFallback}><Badge variant="info">{t('preview.rawFallback')}</Badge><pre className={s.rawPre}>{content.slice(0, 4000)}</pre></div>}
        </Card>
      )}
    </PageShell>
  );
}
