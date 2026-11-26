import { TriangleAlert, ShieldOff, ShieldQuestion } from 'lucide-react';
import type { ConfigHealthViewProps } from '@/contracts/harness/configHealth';
import { Badge } from '../design-system/Badge';
import { Card } from '../design-system/Card';
import { Icon } from '../design-system/Icon';
import s from './ConfigHealthBanner.module.css';

export function ConfigHealthBanner({ issues, showSandboxHint, drill, labels, onDismiss, onDrill }: ConfigHealthViewProps) {
  return (
    <Card level="flat" padding="sm" className={s.banner} data-testid="config-health-banner">
      {issues.map((issue) => (
        <div key={issue.key} className={s.row} data-testid={`config-issue-${issue.key}`}>
          <Icon icon={issue.level === 'critical' ? TriangleAlert : ShieldOff} size={13} className={issue.level === 'critical' ? s.critical : s.warn} />
          <span className={s.text}>{issue.message}</span>
          <Badge variant={issue.level === 'critical' ? 'danger' : 'warning'}>
            {issue.level === 'critical' ? labels.critical : labels.warn}
          </Badge>
          <button type="button" className={s.dismiss} aria-label={labels.close} onClick={() => onDismiss(issue.key)}>×</button>
        </div>
      ))}
      {showSandboxHint && <div className={s.hint}><Icon icon={ShieldQuestion} size={11} />{labels.sandboxHint}</div>}
      <div className={s.drillRow} data-testid="config-drill">
        <button type="button" className={s.drillBtn} onClick={onDrill}>{labels.drill}</button>
        {drill && <span className={s.drillResults} data-testid="config-drill-results">backend: {drill.backend ? 'ok' : 'fail'} · config: {drill.config ? 'ok' : 'fail'}</span>}
      </div>
    </Card>
  );
}
