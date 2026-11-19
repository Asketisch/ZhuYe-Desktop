import { useMemo } from 'react';
import type { ComponentType } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useSessions } from '@/logic/sessions/useSessions';
import { useAgent } from '@/services/agent';
import { useI18n } from '@/utils/i18n';
import { relativeTime } from '@/utils/time';
import type { HomeViewProps } from '@/contracts/home';

export function HomeBinding({ view: View }: { view: ComponentType<HomeViewProps> }) {
  const { buckets } = useSessions();
  const { session } = useAgent();
  const navigate = useNavigate();
  const { t } = useI18n();
  const recent = useMemo(() => {
    const all: Array<{ id: string; label: string; started_at: string; messages: number }> = [];
    for (const b of buckets) for (const sess of b.sessions) all.push({ id: sess.session_id, label: sess.title || sess.session_id.slice(0, 8), started_at: sess.started_at, messages: sess.message_count });
    all.sort((a, b) => b.started_at.localeCompare(a.started_at));
    return all.slice(0, 6).map((item) => ({ id: item.id, label: item.label, startedAt: item.started_at, messages: item.messages }));
  }, [buckets]);
  return <View t={t} relative={relativeTime} recent={recent} activeModel={session ? { model: session.model, provider: session.provider } : undefined}
    onOpen={(to) => { void navigate({ to }); }} onOpenSession={(id) => { void navigate({ to: '/chat/$sessionId', params: { sessionId: id } }); }} />;
}
