import type { I18nContextValue } from '@/utils/i18n/context';
import type { SecurityScanResult } from '@/utils/commands/harness/security';
import type { ZhuyeUpdateInfo } from '@/utils/commands/harness/updates';

export interface GuardStatsCardProps { t: I18nContextValue['t']; busy: boolean; error: string | null; queried: boolean; onRun: () => void }
export interface SecurityScanCardProps { t: I18nContextValue['t']; busy: boolean; report: SecurityScanResult | null; error: string | null; onRun: () => void }
/** OTA 自更新安装状态（progress 百分比;总量未知时为 null）。 */
export interface UpdateInstallState { phase: 'idle' | 'downloading' | 'installing' | 'done' | 'error'; percent: number | null; error: string | null; version: string | null }
export interface UpdatesSectionProps {
  t: I18nContextValue['t'];
  busy: boolean;
  info: ZhuyeUpdateInfo | null;
  onCheck: () => void;
  /** 自更新安装状态（null = 本次会话未发起过安装）。 */
  install: UpdateInstallState | null;
  onInstall: () => void;
  onRelaunch: () => void;
}
