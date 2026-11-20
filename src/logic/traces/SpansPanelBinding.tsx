/**
 * SpansPanel 绑定——读取 span 日志并把展示数据交给可替换视图。
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { zhuye_list_span_logs, zhuye_read_span_log } from '@/utils/commands/traces';
import type { ComponentType } from 'react';
import type { SpansPanelViewProps } from '@/contracts/traces_spans';
import { useI18n } from '@/utils/i18n';

export function SpansPanelBinding({ view: SpansPanelView }: { view: ComponentType<SpansPanelViewProps> }) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<string | null>(null);
  const filesQ = useQuery({
    queryKey: ['traces', 'span-files'],
    queryFn: () => zhuye_list_span_logs(7),
    staleTime: 30_000,
  });
  const files = filesQ.data ?? [];
  const day = picked ?? files[0]?.day ?? null;
  const spansQ = useQuery({
    queryKey: ['traces', 'spans', day],
    queryFn: () => zhuye_read_span_log(day as string),
    enabled: !!day,
    staleTime: 30_000,
  });
  const spans = spansQ.data ?? [];
  const error = spansQ.error instanceof Error ? spansQ.error.message : spansQ.error ? String(spansQ.error) : null;
  return (
    <SpansPanelView
      t={t as SpansPanelViewProps['t']}
      files={files.map((f) => ({ day: f.day }))}
      pickedDay={day}
      onDayChange={(value) => setPicked(value || null)}
      spans={spans}
      loading={spansQ.isLoading}
      error={error}
      labels={{
        day: t('traces.spans.day'), noFiles: t('traces.spans.noFiles'),
        empty: t('traces.spans.empty'), emptyHint: t('traces.spans.emptyHint'),
      }}
    />
  );
}
