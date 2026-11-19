import type { I18nContextValue } from '@/utils/i18n/context';
import type { KmsController } from '@/logic/kms/useKmsController';

export interface KmsViewProps { t: I18nContextValue['t']; ctrl: KmsController }

export type { ReflectSearchResult, ReflectWikiInfo, ReflectPage } from '@/utils/commands';
