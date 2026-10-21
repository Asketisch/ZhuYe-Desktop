/**
 * Traces —— 本地 LLM 调用记录浏览器(CLI `reflect traces ls / show` 的 GUI 对应)。
 *
 * 左栏 session 摘要(调用数 / 最近时间 / 模型),右栏选中 session 的逐条
 * 调用详情(模型 / 耗时 / 来源 / token 用量 / 脱敏请求响应概要)。
 */
import { useState } from 'react';
import { Activity } from 'lucide-react';
import { PageShell } from '@/features/shell/PageShell';
import { Badge, Button, Card, EmptyState, Icon } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { useTracesController } from './useTracesController';
import { SpansPanel } from './SpansPanel';
import s from './TracesView.module.css';

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function TracesView() {
  const { t } = useI18n();
  const c = useTracesController();
  // 两个视角:model-io 的逐条调用详情 / span 日志的父子链。
  const [tab, setTab] = useState<'calls' | 'spans'>('calls');
  const selected = c.sessions.find((x) => x.sessionId === c.selectedId);

  return (
    <PageShell
      icon={Activity}
      title={t('traces.title')}
      subtitle={t('traces.subtitle')}
      width="lg"
      actions={<Button size="sm" variant="ghost" onClick={c.refresh}>{t('traces.refresh')}</Button>}
    >
      <div className={s.tabBar} role="tablist" aria-label={t('traces.tabs')}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'calls'}
          className={s.tab}
          data-active={tab === 'calls' || undefined}
          onClick={() => setTab('calls')}
          data-testid="traces-tab-calls"
        >
          {t('traces.tab.calls')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'spans'}
          className={s.tab}
          data-active={tab === 'spans' || undefined}
          onClick={() => setTab('spans')}
          data-testid="traces-tab-spans"
        >
          {t('traces.tab.spans')}
        </button>
      </div>

      {tab === 'spans' ? (
        <SpansPanel />
      ) : (
      <div className={s.layout}>
        <section aria-label={t('traces.sessionList')}>
          {c.listError ? (
            <Card level="flat" padding="sm">
              <p className={s.callBody}>{c.listError}</p>
            </Card>
          ) : c.sessions.length === 0 && !c.loading ? (
            <Card level="flat" padding="none">
              <EmptyState
                size="sm"
                icon={<Icon icon={Activity} />}
                title={t('traces.empty')}
                description={t('traces.emptyHint')}
              />
            </Card>
          ) : (
            <div className={s.sessionList} data-testid="traces-session-list">
              {c.sessions.map((x) => (
                <Card
                  key={x.sessionId}
                  level="outlined"
                  padding="sm"
                  className={s.sessionRow}
                  data-selected={x.sessionId === c.selectedId}
                  onClick={() => c.select(x.sessionId)}
                >
                  <span className={s.sessionTitle}>{x.title}</span>
                  <span className={s.sessionMeta}>
                    <span className={s.sessionId}>{x.sessionId.slice(0, 8)}</span>
                    <span>{x.calls} {t('traces.callsUnit')}</span>
                    <span>{x.model || '—'}</span>
                  </span>
                </Card>
              ))}
            </div>
          )}
        </section>

        <section className={s.detail} aria-label={t('traces.detailTitle')}>
          {!selected ? (
            <Card level="flat" padding="none">
              <EmptyState
                size="sm"
                icon={<Icon icon={Activity} />}
                title={t('traces.selectPrompt')}
                className={s.emptyDetail}
              />
            </Card>
          ) : (
            <>
              <div className={s.detailHeader} data-testid="traces-detail-header">
                <strong>{selected.title}</strong>
                <span className={s.sessionId}>{selected.sessionId.slice(0, 8)}</span>
                {selected.lastSource && <Badge variant="neutral">{selected.lastSource}</Badge>}
                <span>{fmtTime(selected.lastAt)}</span>
              </div>
              {c.callsError ? (
                <Card level="flat" padding="sm">
                  <p className={s.callBody}>{c.callsError}</p>
                </Card>
              ) : c.callsLoading ? (
                <Card level="flat" padding="sm">
                  <p className={s.callBody}>{t('traces.loading')}</p>
                </Card>
              ) : (
                c.calls.map((call, i) => (
                  <Card key={call.requestId} level="outlined" padding="sm" className={s.callCard}>
                    <div className={s.callHeader}>
                      <span>#{i + 1}</span>
                      <span className={s.callModel}>{call.model.modelId}</span>
                      {call.model.providerId && <span>{call.model.providerId}</span>}
                      <Badge variant="neutral">{call.querySource}</Badge>
                      <span>{call.durationMs}ms</span>
                      {call.attempt > 1 && <Badge variant="warning">retry {call.attempt}</Badge>}
                      <span title={t('traces.usageTitle')}>
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
                ))
              )}
            </>
          )}
        </section>
      </div>
      )}
    </PageShell>
  );
}
