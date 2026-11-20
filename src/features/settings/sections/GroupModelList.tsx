/**
 * 模型列表区 —— 默认模型输入 + 自动拉取清单（GroupDetail 的组成块）。
 *
 * 点选清单行 = 设为组默认模型（落盘与否由调用方的 onPick 决定：
 * 新增模式只填表单，避免把半截表单 upsert 成残缺组条目）。
 */
import { RefreshCw } from 'lucide-react';
import { Button, Icon, Input } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import type { ProviderModelInfo } from '@/utils/commands';
import { ModelOptionsList } from '../components/ModelOptionsList';
import s from '@/render/settings/SettingsView.module.css';

export interface GroupModelListProps {
  /** 组默认模型（表单字段）。 */
  model: string;
  onModelChange: (value: string) => void;
  /** 自动拉取的清单；null = 尚未拉取。 */
  models: ProviderModelInfo[] | null;
  fetching: boolean;
  modelsError: string | null;
  /** 端点三元组是否配齐（base_url + key；openai 可免 Key）。 */
  canFetch: boolean;
  onFetch: () => void;
  onPick: (modelId: string) => void;
}

export function GroupModelList({
  model,
  onModelChange,
  models,
  fetching,
  modelsError,
  canFetch,
  onFetch,
  onPick,
}: GroupModelListProps) {
  const { t } = useI18n();
  return (
    <div className={s.fieldRow}>
      <label className={s.fieldLabel}>{t('settings.groups.modelsTitle')}</label>
      <span className={s.modelFetchRow}>
        <Input
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          placeholder="GLM-5.3-Flash / claude-sonnet-4 …"
          aria-label={t('settings.groups.model')}
        />
        <Button
          variant="ghost"
          size="sm"
          disabled={fetching || !canFetch}
          data-testid="groups-fetch-models"
          title={modelsError ?? t('settings.groups.autoFetchHint')}
          onClick={onFetch}
        >
          <Icon icon={RefreshCw} size={12} />{' '}
          {fetching ? t('settings.groups.fetchingModels') : t('settings.groups.fetchModels')}
        </Button>
      </span>
      {models && !modelsError && (
        <span className={s.fetchHint}>
          {t('settings.groups.modelsFetched', { count: String(models.length) })}
        </span>
      )}
      {modelsError && <span className={s.fetchHint} data-failed>{modelsError}</span>}
      {models && !modelsError && models.length > 0 && (
        <ModelOptionsList models={models} value={model} onPick={(m) => onPick(m.id)} testId="groups-model-options" />
      )}
    </div>
  );
}
