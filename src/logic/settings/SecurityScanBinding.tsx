import { useState } from 'react';
import type { ComponentType } from 'react';
import { useI18n } from '@/utils/i18n';
import { reflect_run_security_scan, type SecurityScanResult } from '@/utils/commands/security';
import type { SecurityScanCardProps } from '@/contracts/settingsCards';
export function SecurityScanBinding({ view: View }: { view: ComponentType<SecurityScanCardProps> }) {
  const { t } = useI18n(); const [busy, setBusy] = useState(false); const [report, setReport] = useState<SecurityScanResult | null>(null); const [error, setError] = useState<string | null>(null);
  const run = async () => { setBusy(true); setError(null); try { setReport(await reflect_run_security_scan()); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } };
  return <View t={t} busy={busy} report={report} error={error} onRun={() => { void run(); }} />;
}
