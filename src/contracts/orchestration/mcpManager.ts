import type { I18nContextValue } from '@/utils/i18n/context';
import type { McpManagerController } from '@/logic/orchestration/collaboration/useMcpManagerController';
export interface McpManagerProps { t: I18nContextValue['t']; ctrl: McpManagerController }

export type { McpServerEntry } from '@/utils/commands/mcp';
