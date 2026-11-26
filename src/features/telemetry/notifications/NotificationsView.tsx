import { useRenderView } from '@/logic/renderer/useRenderView';
import { NotificationsBinding } from '@/logic/notifications/NotificationsBinding';
import { NotificationsView as DefaultView } from '@/render/notifications/NotificationsView';

export function NotificationsView() {
  const View = useRenderView('NotificationsView', DefaultView);
  return <NotificationsBinding view={View} />;
}
