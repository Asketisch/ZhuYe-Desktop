import type { I18nContextValue } from '@/utils/i18n/context';
import type { RemoteController } from '@/logic/connect/remote/useRemoteController';

export interface RemoteViewProps {
  t: I18nContextValue['t'];
  ctrl: RemoteController;
  copyOk: boolean;
  onCopyPreview: () => void;
}

export type { RemoteConfigDraft } from '@/logic/connect/remote/useRemoteController';
