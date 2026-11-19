import { useState } from 'react';
import type { ComponentType } from 'react';
import { useI18n } from '@/utils/i18n';
import { reflect_check_update, type ReflectUpdateInfo } from '@/utils/commands/updates';
import type { UpdatesSectionProps } from '@/contracts/settingsCards';
export function UpdatesBinding({ view: View }: { view: ComponentType<UpdatesSectionProps> }) {
  const { t } = useI18n(); const [info, setInfo] = useState<ReflectUpdateInfo | null>(null); const [busy, setBusy] = useState(false);
  const check = async () => { setBusy(true); try { setInfo(await reflect_check_update()); } catch (cause) { setInfo({ currentVersion: '', latestVersion: null, updateAvailable: false, releaseUrl: null, releaseNotes: null, probedAt: Date.now(), error: cause instanceof Error ? cause.message : String(cause) }); } finally { setBusy(false); } };
  return <View t={t} busy={busy} info={info} onCheck={() => { void check(); }} />;
}
