import type { I18nContextValue } from '@/utils/i18n/context';
import type { SecurityScanResult } from '@/utils/commands/security';
import type { ReflectUpdateInfo } from '@/utils/commands/updates';

export interface GuardStatsCardProps { t: I18nContextValue['t']; busy: boolean; error: string | null; queried: boolean; onRun: () => void }
export interface SecurityScanCardProps { t: I18nContextValue['t']; busy: boolean; report: SecurityScanResult | null; error: string | null; onRun: () => void }
export interface UpdatesSectionProps { t: I18nContextValue['t']; busy: boolean; info: ReflectUpdateInfo | null; onCheck: () => void }
