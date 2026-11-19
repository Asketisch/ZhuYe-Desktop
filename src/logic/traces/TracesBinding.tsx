/**
 * Traces 绑定——控制器数据转发给可替换视图。
 */
import { useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { TracesViewProps } from '@/contracts/traces';
import { useI18n } from '@/utils/i18n';
import { useTracesController } from './useTracesController';
import { SpansPanelBinding } from './SpansPanelBinding';
import type { SpansPanelViewProps } from '@/contracts/traces_spans';

export function TracesBinding({ view: View, spansView }: { view: ComponentType<TracesViewProps>; spansView: ComponentType<SpansPanelViewProps> }) {
  const c = useTracesController();
  const { t } = useI18n();
  const [tab, setTab] = useState<'calls' | 'spans'>('calls');
  const spansSlot: ReactNode = tab === 'spans' ? <SpansPanelBinding view={spansView} /> : null;
  return (
    <View
      t={t} iconName="activity" title={t('traces.title')} subtitle={t('traces.subtitle')} width="lg"
      tab={tab} onTabChange={setTab}
      sessions={c.sessions.map((x) => ({ ...x }))}
      loading={c.loading} listError={c.listError} selectedId={c.selectedId}
      calls={c.calls as never} callsLoading={c.callsLoading} callsError={c.callsError}
      onSelect={c.select} onRefresh={c.refresh} spansSlot={spansSlot}
      labels={{
        tabs: t('traces.tabs'), callTab: t('traces.tab.calls'), spanTab: t('traces.tab.spans'),
        sessionList: t('traces.sessionList'), callsUnit: t('traces.callsUnit'),
        detailTitle: t('traces.detailTitle'), loading: t('traces.loading'), usageTitle: t('traces.usageTitle'),
        empty: t('traces.empty'), emptyHint: t('traces.emptyHint'), selectPrompt: t('traces.selectPrompt'),
        refresh: t('traces.refresh'),
      }}
    />
  );
}
