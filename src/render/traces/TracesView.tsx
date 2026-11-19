/**
 * Traces —— LLM 调用记录浏览纯展示视图。
 */
import { Activity } from 'lucide-react';
import type { ComponentType } from 'react';
import type { TraceCallRow, TracesViewProps } from '@/contracts/traces';
import { PageShell } from '../shell/PageShell';
import { Badge } from '../design-system/Badge';
import { Button } from '../design-system/Button';
import { Card } from '../design-system/Card';
import { EmptyState } from '../design-system/EmptyState';
import { Icon } from '../design-system/Icon';
import s from './TracesView.module.css';

const ICONS: Record<string, ComponentType> = { activity: Activity };

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function TracesView({
  iconName, title, subtitle, width, tab, onTabChange, sessions, loading, listError,
  selectedId, calls, callsLoading, callsError, onSelect, onRefresh, spansSlot, labels,
}: TracesViewProps) {
  const selected = sessions.find((x) => x.sessionId === selectedId) ?? null;
  return (
    <PageShell icon={ICONS[iconName]} title={title} subtitle={subtitle} width={width}
      actions={<Button size="sm" variant="ghost" onClick={onRefresh}>{labels.refresh}</Button>}
    >
      <div className={s.tabBar} role="tablist" aria-label={labels.tabs}>
        <button type="button" role="tab" aria-selected={tab === 'calls'} className={s.tab}
          data-active={tab === 'calls' || undefined} onClick={() => onTabChange('calls')}
          data-testid="traces-tab-calls">{labels.callTab}</button>
        <button type="button" role="tab" aria-selected={tab === 'spans'} className={s.tab}
          data-active={tab === 'spans' || undefined} onClick={() => onTabChange('spans')}
          data-testid="traces-tab-spans">{labels.spanTab}</button>
      </div>

      {tab === 'spans' ? <>{spansSlot}</> : (
        <div className={s.layout}>
          <section aria-label={labels.sessionList}>
            {listError ? (
              <Card level="flat" padding="sm"><p className={s.callBody}>{listError}</p></Card>
            ) : sessions.length === 0 && !loading ? (
              <Card level="flat" padding="none">
                <EmptyState size="sm" icon={<Icon icon={Activity} />} title={labels.empty} description={labels.emptyHint} />
              </Card>
            ) : (
              <div className={s.sessionList} data-testid="traces-session-list">
                {sessions.map((x) => (
                  <Card key={x.sessionId} level="outlined" padding="sm" className={s.sessionRow}
                    data-selected={x.sessionId === selectedId} onClick={() => onSelect(x.sessionId)}>
                    <span className={s.sessionTitle}>{x.title}</span>
                    <span className={s.sessionMeta}>
                      <span className={s.sessionId}>{x.sessionId.slice(0, 8)}</span>
                      <span>{x.calls} {labels.callsUnit}</span>
                      <span>{x.model || '—'}</span>
                    </span>
                  </Card>
                ))}
              </div>
            )}
          </section>

          <section className={s.detail} aria-label={labels.detailTitle}>
            {!selected ? (
              <Card level="flat" padding="none">
                <EmptyState size="sm" icon={<Icon icon={Activity} />} title={labels.selectPrompt} className={s.emptyDetail} />
              </Card>
            ) : (
              <>
                <div className={s.detailHeader} data-testid="traces-detail-header">
                  <strong>{selected.title}</strong>
                  <span className={s.sessionId}>{selected.sessionId.slice(0, 8)}</span>
                  {selected.lastSource && <Badge variant="neutral">{selected.lastSource}</Badge>}
                  <span>{fmtTime(selected.lastAt)}</span>
                </div>
                {callsError ? (
                  <Card level="flat" padding="sm"><p className={s.callBody}>{callsError}</p></Card>
                ) : callsLoading ? (
                  <Card level="flat" padding="sm"><p className={s.callBody}>{labels.loading}</p></Card>
                ) : calls.map((call, i) => <CallCard key={call.requestId} index={i} call={call} labels={labels} />)}
              </>
            )}
          </section>
        </div>
      )}
    </PageShell>
  );
}

function CallCard({ index, call, labels }: { index: number; call: TraceCallRow; labels: TracesViewProps['labels'] }) {
  return (
    <Card level="outlined" padding="sm" className={s.callCard}>
      <div className={s.callHeader}>
        <span>#{index + 1}</span>
        <span className={s.callModel}>{call.model.modelId}</span>
        {call.model.providerId && <span>{call.model.providerId}</span>}
        <Badge variant="neutral">{call.querySource}</Badge>
        <span>{call.durationMs}ms</span>
        {call.attempt > 1 && <Badge variant="warning">retry {call.attempt}</Badge>}
        <span title={labels.usageTitle}>
          {fmtTokens(call.usage.input_tokens)}↓ {fmtTokens(call.usage.output_tokens)}↑
          {call.usage.cost_usd != null && ` · $${call.usage.cost_usd.toFixed(4)}`}
        </span>
      </div>
      <div className={s.callBody}>
        {JSON.stringify(call.request, null, 2)}
        {'\n---\n'}
        {JSON.stringify(call.response, null, 2)}
      </div>
    </Card>
  );
}

/** 占位槽：原 SpansPanel 由滑块插槽注入，避免渲染层引用切片。 */
