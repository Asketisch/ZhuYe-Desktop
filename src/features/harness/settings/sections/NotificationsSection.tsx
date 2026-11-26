import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { NotificationsBinding } from '@/logic/harness/settings/NotificationsBinding';
import { NotificationsSection as DefaultView } from '@/render/harness/settings/NotificationsSection';
export function NotificationsSection() { const View = useRenderView('NotificationsSection', DefaultView); return <NotificationsBinding view={View} />; }
