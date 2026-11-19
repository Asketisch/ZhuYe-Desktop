import type { ComponentType } from 'react';
import { useI18n } from '@/utils/i18n';
import { useMcpManagerController } from './useMcpManagerController';
import type { McpManagerProps } from '@/contracts/mcpManager';
export function McpManagerBinding({ view: View }: { view: ComponentType<McpManagerProps> }) {
  const { t } = useI18n(); return <View t={t} ctrl={useMcpManagerController()} />;
}
