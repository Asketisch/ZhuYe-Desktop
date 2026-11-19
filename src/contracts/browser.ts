import type { I18nContextValue } from '@/utils/i18n/context';
import type { ReflectBrowserStatus } from '@/utils/commands/browser';

/** 浏览器面板视图 props(渲染层可整体替换)。 */
export interface BrowserPanelProps {
  t: I18nContextValue['t'];
  /** 面板状态(null = 尚未查询)。 */
  status: ReflectBrowserStatus | null;
  /** 当前帧 data URL(无帧为 null)。 */
  frame: string | null;
  /** start/stop 进行中。 */
  busy: boolean;
  /** 动作失败信息。 */
  error: string | null;
  onStart: () => void;
  onStop: () => void;
  onRefresh: () => void;
}
