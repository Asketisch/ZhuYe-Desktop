/**
 * SpansPanel —— span 日志视图(turn → model → tool 父子链)。
 *
 * span 日志是 model-io 的**姊妹**产物:按天写在
 * `~/.zhuye/traces/log/reflect-YYYY-MM-DD.jsonl`,记录 turn / model /
 * tool 的父子 span(含耗时、状态),以及 `reflect_goal` 模块发出的目标
 * 校验事件(`goal.turn.verified` 等)。
 *
 * 与 model-io 的分工:model-io 给出「每次 LLM 调用的请求/响应全文」,
 * span 给出「这次 turn 的结构与耗时归因」。
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { Badge, Card, EmptyState, Icon, Select } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { reflect_list_span_logs, reflect_read_span_log } from '@/utils/commands/traces';
import s from './TracesView.module.css';

export function SpansPanel() {
  const { t } = useI18n();
  const [picked, setPicked] = useState<string | null>(null);

  const filesQ = useQuery({
    queryKey: ['traces', 'span-files'],
    queryFn: () => reflect_list_span_logs(7),
    staleTime: 30_000,
  });
  const files = filesQ.data ?? [];
  const day = picked ?? files[0]?.day ?? null;

  const spansQ = useQuery({
    queryKey: ['traces', 'spans', day],
    queryFn: () => reflect_read_span_log(day as string),
    enabled: !!day,
    staleTime: 30_000,
  });

  const spans = spansQ.data ?? [];

  return (
    <div className={s.spansWrap} data-testid="traces-spans">
      <div className={s.spanBar}>
        <span className={s.spanDayLabel}>{t('traces.spans.day')}</span>
        {files.length > 0 ? (
          <Select
            size="sm"
            value={day ?? ''}
            onChange={(e) => setPicked(e.target.value || null)}
            aria-label={t('traces.spans.day')}
            data-testid="traces-span-day"
          >
            {files.map((f) => (
              <option key={f.day} value={f.day}>
                {f.day}
              </option>
            ))}
          </Select>
        ) : (
          <span className={s.spanEmpty}>{t('traces.spans.noFiles')}</span>
        )}
        <Badge variant="neutral">{spans.length}</Badge>
      </div>

      {spansQ.isError ? (
        <Card level="flat" padding="sm">
          <p className={s.callBody}>
            {spansQ.error instanceof Error ? spansQ.error.message : String(spansQ.error)}
          </p>
        </Card>
      ) : spans.length === 0 && !spansQ.isLoading ? (
        <Card level="flat" padding="none">
          <EmptyState
            size="sm"
            icon={<Icon icon={Activity} />}
            title={t('traces.spans.empty')}
            description={t('traces.spans.emptyHint')}
          />
        </Card>
      ) : (
        <ul className={s.spanList} data-testid="traces-span-list">
          {spans.map((sp) => (
            <li
              key={`${sp.spanId}-${sp.event}-${sp.timestamp}`}
              className={s.spanRow}
              style={{ paddingLeft: `${8 + sp.depth * 14}px` }}
              data-depth={sp.depth}
              data-module={sp.module}
            >
              <span className={s.spanEvent}>{sp.event}</span>
              {sp.module && <span className={s.spanModule}>{sp.module}</span>}
              {sp.status && (
                <Badge
                  variant={sp.status === 'failed' ? 'danger' : sp.status === 'started' ? 'info' : 'neutral'}
                >
                  {sp.status}
                </Badge>
              )}
              {sp.durationMs != null && (
                <span className={s.spanDuration}>{sp.durationMs}ms</span>
              )}
              <span className={s.spanTime}>{new Date(sp.timestamp).toLocaleTimeString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
