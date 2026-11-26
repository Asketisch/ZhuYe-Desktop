import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { NotificationsBinding } from '@/logic/telemetry/notifications/NotificationsBinding';
import { NotificationsView as DefaultView } from '@/render/telemetry/notifications/NotificationsView';

export function NotificationsView() {
  const View = useRenderView('NotificationsView', DefaultView);
  return <NotificationsBinding view={View} />;
}
