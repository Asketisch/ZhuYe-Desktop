import { Download } from 'lucide-react';
import { PageShell } from '../shell/PageShell';
import { Card } from '../design-system/Card';
import { Badge } from '../design-system/Badge';
import { Button } from '../design-system/Button';
import { Select } from '../design-system/Select';
import { Spinner } from '../design-system/Spinner';
import type { ImportViewProps } from '@/contracts/importView';
import s from './ImportView.module.css';

export function ImportView({ t, kinds, kind, onKindChange, dryRun, onDryRunChange, sourcesCount, discoverLoading, running, disabled, result, onImport }: ImportViewProps) {
  return (
    <PageShell icon={Download} title={t('import.title')} subtitle={t('import.subtitle')} width="md">
      <Card level="flat" padding="lg">
        <div className={s.row}><span className={s.label}>{t('import.kind')}</span>
          <Select value={kind} onChange={(e) => onKindChange(e.target.value)} aria-label={t('import.kind')} data-testid="import-kind-select">
            {kinds.map((k) => <option key={k.value} value={k.value}>{t(k.labelKey)}</option>)}
          </Select></div>
        <div className={s.row}><span className={s.label}>{t('import.discovered')}</span>
          {discoverLoading ? <Spinner size={16} /> : sourcesCount === null ? <Badge variant="warning">{t('import.discoverFailed')}</Badge> : <Badge variant="neutral" data-testid="import-source-count">{sourcesCount}</Badge>}</div>
        <div className={s.row}>
          <label className={s.checkRow}><input type="checkbox" checked={dryRun} onChange={(e) => onDryRunChange(e.target.checked)} data-testid="import-dry-run" /><span>{t('import.dryRun')}</span></label>
          <Button variant="primary" size="sm" disabled={disabled || running} onClick={onImport} data-testid="import-run-btn">{running ? t('import.running') : dryRun ? t('import.preview') : t('import.run')}</Button>
        </div>
        <p className={s.hint}>{t('import.hint')}</p>
      </Card>
      {result && (
        <Card level="outlined" padding="lg" data-testid="import-result">
          <div className={s.resultHeader}><strong>{dryRun ? t('import.previewTitle') : t('import.resultTitle')}</strong>
            <Badge variant="success">{t('import.importedCount', { count: result.imported.length })}</Badge>
            {result.failed.length > 0 && <Badge variant="warning">{t('import.failedCount', { count: result.failed.length })}</Badge>}</div>
          {result.imported.map((o) => <div key={o.source} className={s.resultRow} data-testid="import-success-row"><code className={s.resultSource}>{o.source}</code><span className={s.resultDetail}>{o.turns} {t('import.turnsUnit')} · {o.records} {t('import.recordsUnit')}</span></div>)}
          {result.failed.map((f) => <div key={f.source} className={s.resultRow} data-testid="import-failure-row"><code className={s.resultSource}>{f.source}</code><span className={`${s.resultDetail} ${s.errorText}`}>{f.error}</span></div>)}
          {result.imported.length === 0 && result.failed.length === 0 && <p className={s.hint}>{t('import.nothingToImport')}</p>}
        </Card>
      )}
    </PageShell>
  );
}
