import type { I18nContextValue } from '@/utils/i18n/context';

/** 个性化分区（用户级自定义指令）契约。 */
export interface SettingsPersonalizationProps {
  t: I18nContextValue['t'];
  /** 当前草稿内容（未编辑时 = 服务端内容）。 */
  content: string;
  loading: boolean;
  saving: boolean;
  saved: boolean;
  /** 草稿与服务端内容是否不一致。 */
  dirty: boolean;
  error: string | null;
  onChange: (next: string) => void;
  onSave: () => void;
  /** 丢弃未保存草稿，回到服务端内容。 */
  onReset: () => void;
}
