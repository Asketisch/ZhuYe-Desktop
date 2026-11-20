import { useState } from 'react';
import type { ComponentType } from 'react';
import { useI18n } from '@/utils/i18n';
import { zhuye_query_guard_stats } from '@/utils/commands/skills';
import type { GuardStatsCardProps } from '@/contracts/settingsCards';
export function GuardStatsBinding({ view: View }: { view: ComponentType<GuardStatsCardProps> }) {
  const { t } = useI18n(); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [queried, setQueried] = useState(false);
  const run = async () => { setBusy(true); setError(null); try { await zhuye_query_guard_stats(); setQueried(true); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } };
  return <View t={t} busy={busy} error={error} queried={queried} onRun={() => { void run(); }} />;
}
