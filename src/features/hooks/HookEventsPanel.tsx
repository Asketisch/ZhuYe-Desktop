/**
 * HookEventsPanel —— 可挂载的 hook 事件类型 + 每个事件可用的决策。
 *
 * 此前 Hooks 视图只列已注册的 hook(name / kind / enabled)—— 用户不知道
 * **能在哪些时机**挂 hook、每个时机能做什么决策。核心的 `HookEventKind`
 * 有 12 个变体、`HookDecision` 有 7 种,这里如实列出。
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, Spinner } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { reflect_list_hook_events } from '@/utils/commands/hooks';
import s from './HooksView.module.css';

export function HookEventsPanel() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['hook-events'],
    queryFn: () => reflect_list_hook_events(),
    enabled: open,
    staleTime: 300_000,
  });
  const events = q.data ?? [];

  return (
    <div className={s.eventsPanel} data-testid="hooks-events-panel">
      <button
        type="button"
        className={s.eventsToggle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="hooks-events-toggle"
      >
        {open ? '▾' : '▸'} {t('hooks.events.title')}
      </button>
      {open && (
        <Card level="flat" padding="sm" className={s.eventsCard}>
          {q.isLoading ? (
            <div className={s.center}><Spinner size={14} /> {t('common.loading')}</div>
          ) : (
            <ul className={s.eventsList} data-testid="hooks-events-list">
              {events.map((e) => (
                <li key={e.kind} className={s.eventsRow}>
                  <div className={s.eventsMain}>
                    <code className={s.name}>{e.kind}</code>
                    <span className={s.summary}>{e.description}</span>
                  </div>
                  <div className={s.eventsDecisions}>
                    {e.decisions.map((d) => (
                      <Badge key={d} variant="neutral">{d}</Badge>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
