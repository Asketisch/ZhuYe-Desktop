/**
 * SpansPanel —— span 日志纯展示视图。
 */
import { Activity } from 'lucide-react';
import type { SpansPanelViewProps } from '@/contracts/traces_spans';
import { Badge } from '../design-system/Badge';
import { Card } from '../design-system/Card';
import { EmptyState } from '../design-system/EmptyState';
import { Icon } from '../design-system/Icon';
import { Select } from '../design-system/Select';
import s from './TracesView.module.css';

export function SpansPanel({ files, pickedDay, onDayChange, spans, loading, error, labels }: SpansPanelViewProps) {
  return (
    <div className={s.spansWrap} data-testid="traces-spans">
      <div className={s.spanBar}>
        <span className={s.spanDayLabel}>{labels.day}</span>
        {files.length > 0 ? (
          <Select size="sm" value={pickedDay ?? ''} onChange={(e) => onDayChange(e.target.value || null)}
            aria-label={labels.day} data-testid="traces-span-day">
            {files.map((f) => <option key={f.day} value={f.day}>{f.day}</option>)}
          </Select>
        ) : <span className={s.spanEmpty}>{labels.noFiles}</span>}
        <Badge variant="neutral">{spans.length}</Badge>
      </div>

      {error ? (
        <Card level="flat" padding="sm"><p className={s.callBody}>{error}</p></Card>
      ) : spans.length === 0 && !loading ? (
        <Card level="flat" padding="none">
          <EmptyState size="sm" icon={<Icon icon={Activity} />} title={labels.empty} description={labels.emptyHint} />
        </Card>
      ) : (
        <ul className={s.spanList} data-testid="traces-span-list">
          {spans.map((sp) => (
            <li key={`${sp.spanId}-${sp.event}-${sp.timestamp}`} className={s.spanRow}
              style={{ paddingLeft: `${8 + sp.depth * 14}px` }} data-depth={sp.depth} data-module={sp.module}>
              <span className={s.spanEvent}>{sp.event}</span>
              {sp.module && <span className={s.spanModule}>{sp.module}</span>}
              {sp.status && <Badge variant={sp.status === 'failed' ? 'danger' : sp.status === 'started' ? 'info' : 'neutral'}>{sp.status}</Badge>}
              {sp.durationMs != null && <span className={s.spanDuration}>{sp.durationMs}ms</span>}
              <span className={s.spanTime}>{new Date(sp.timestamp).toLocaleTimeString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
