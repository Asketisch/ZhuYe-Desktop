import type { NotificationsController } from '@/logic/notifications/useNotificationsController';
export type { NotifItem, NotificationFilter, NotificationTab } from '@/logic/notifications/useNotificationsController';
export type { ZhuyeActivityEvent } from '@/utils/commands/activity';
export interface NotificationsViewProps { ctrl: NotificationsController }
