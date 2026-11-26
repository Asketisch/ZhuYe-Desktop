import type { I18nContextValue } from '@/utils/i18n/context';
import type { Effort } from '@/logic/composer/useEffortCapability';

/** 模型组卡片视图 —— 模型页按组列出（组 id 才是切换目标）。 */
export interface ModelsGroupView {
  /** 组 id —— 「设为默认」时写入 `[active].group`。 */
  id: string;
  /** 展示名（label 优先，回退 id）。 */
  label: string;
  /** 线格式（openai / anthropic / ollama）。 */
  endpoint: string;
  /** 组级默认模型。 */
  model: string;
  /** 组内凭据数。 */
  credentialCount: number;
  /** 组内被钉住的凭据 label（未钉住时为 null）。 */
  pinnedCredential: string | null;
  /** 是否当前默认组。 */
  isDefault: boolean;
  switching: boolean;
}
export interface ModelsEffortOption {
  value: Effort;
  label: string;
  hint: string;
}
export interface ModelsViewProps {
  t: I18nContextValue['t'];
  loading: boolean;
  hasModel: boolean;
  model: string | undefined;
  /** 当前模型能力标签(已在绑定层拼好本地化文案,如「200K 上下文」);空数组 = 全未知。 */
  abilityTags: string[];
  workspace: string | undefined;
  degradedReason: string | null;
  groups: ModelsGroupView[];
  effort: Effort;
  effortOptions: ModelsEffortOption[];
  effortAdjusted: boolean;
  /** 实际生效档位（绑定层已本地化的文案，如「高」）；null = 不发思考参数。 */
  effortEffectiveLabel: string | null;
  saved: boolean;
  onGoSettings: () => void;
  onSwitchGroup: (group: ModelsGroupView) => void;
  onEffortChange: (effort: Effort) => void;
  onApplyEffort: () => void;
}
