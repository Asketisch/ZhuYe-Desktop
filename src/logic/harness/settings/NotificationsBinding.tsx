import { useCallback, useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { useI18n } from '@/utils/i18n';
import { loadNotifyOptions, saveNotifyOptions, requestNotificationPermission, type AgentNotifyOptions } from '@/utils/notify';
import type { SettingsNotificationsProps } from '@/contracts/settings/settingsNotifications';
export function NotificationsBinding({ view: View }: { view: ComponentType<SettingsNotificationsProps> }) {
  const { t } = useI18n(); const [opts, setOpts] = useState<AgentNotifyOptions>(() => loadNotifyOptions());
  const [permission, setPermission] = useState(() => typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported');
  useEffect(() => saveNotifyOptions(opts), [opts]);
  const requestPermission = useCallback(async () => setPermission(await requestNotificationPermission()), []);
  return <View t={t} opts={opts} permission={permission} onPatch={(patch) => setOpts((current) => ({ ...current, ...patch }))} onRequestPermission={() => { void requestPermission(); }} />;
}
