import type { ComponentType } from 'react';
import { useNotificationsController } from './useNotificationsController';
import type { NotificationsViewProps } from '@/contracts/telemetry/notifications';
export function NotificationsBinding({ view: View }: { view: ComponentType<NotificationsViewProps> }) {
  return <View ctrl={useNotificationsController()} />;
}
