import type { NotificationsController } from '@/logic/telemetry/notifications/useNotificationsController';
export type { NotifItem, NotificationFilter, NotificationTab } from '@/logic/telemetry/notifications/useNotificationsController';
export type { ZhuyeActivityEvent } from '@/utils/commands/activity';
export interface NotificationsViewProps { ctrl: NotificationsController }
