import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/utils/i18n';
import { useAgentStore } from '@/stores/agentStore';
import { reflect_list_hooks, reflect_toggle_hook, reflect_list_hook_events } from '@/utils/commands';
import type { HooksViewProps, HookView } from '@/contracts/hooks';

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'msg' in error && typeof error.msg === 'string') return error.msg;
  return String(error);
}

/** Hook 管理绑定。 */
export function HooksBinding({ view: View }: { view: ComponentType<HooksViewProps> }) {
  const { t } = useI18n();
  const pushToast = useAgentStore((st) => st.pushToast);
  const [hooks, setHooks] = useState<HookView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [eventsOpen, setEventsOpen] = useState(false);
  const pending = useRef(false);
  const refreshRevision = useRef(0);

  const refresh = useCallback(() => {
    const revision = ++refreshRevision.current;
    setLoading(true);
    setError(null);
    reflect_list_hooks()
      .then((list) => { if (refreshRevision.current === revision) setHooks(list.map((h) => ({ name: h.name, kind: h.kind, enabled: h.enabled, config_summary: h.config_summary }))); })
      .catch((e: unknown) => { if (refreshRevision.current === revision) setError(errorMessage(e)); })
      .finally(() => { if (refreshRevision.current === revision) setLoading(false); });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const toggle = async (hook: HookView) => {
    if (pending.current) return;
    pending.current = true;
    setPendingName(hook.name);
    try {
      await reflect_toggle_hook(hook.name, !hook.enabled);
      refresh();
    } catch (e) {
      pushToast({ kind: 'error', message: errorMessage(e) });
    } finally {
      setPendingName(null);
      pending.current = false;
    }
  };

  const eventsQ = useQuery({
    queryKey: ['hook-events'],
    queryFn: () => reflect_list_hook_events(),
    enabled: eventsOpen,
    staleTime: 300_000,
  });

  return (
    <View
      t={t}
      hooks={hooks}
      loading={loading}
      error={error}
      pendingName={pendingName}
      eventsOpen={eventsOpen}
      eventsLoading={eventsQ.isLoading}
      events={eventsQ.data ?? []}
      onToggle={(hook) => { void toggle(hook); }}
      onRefresh={refresh}
      onEventsToggle={() => setEventsOpen((v) => !v)}
    />
  );
}
