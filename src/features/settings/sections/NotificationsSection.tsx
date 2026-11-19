import { useRenderView } from '@/logic/renderer/useRenderView';
import { NotificationsBinding } from '@/logic/settings/NotificationsBinding';
import { NotificationsSection as DefaultView } from '@/render/settings/NotificationsSection';
export function NotificationsSection() { const View = useRenderView('NotificationsSection', DefaultView); return <NotificationsBinding view={View} />; }
