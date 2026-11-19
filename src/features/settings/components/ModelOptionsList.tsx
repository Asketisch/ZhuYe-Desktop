/**
 * 拉取到的模型清单的可点击列表（plan 表单与模型组表单共用）。
 *
 * 显式 listbox 而非 <datalist>：WKWebView(macOS Tauri) 对 datalist
 * 建议下拉支持不可靠，拉取后无任何可选入口。
 */
import { useI18n } from '@/utils/i18n';
import type { ProviderModelInfo } from '@/utils/commands';
import s from '@/render/settings/SettingsView.module.css';

export function ModelOptionsList({
  models,
  value,
  onPick,
  testId = 'plans-model-options',
}: {
  models: ProviderModelInfo[];
  /** 当前选中的模型 id（aria-selected 高亮）。 */
  value: string;
  onPick: (id: string) => void;
  testId?: string;
}) {
  const { t } = useI18n();
  /** 能力标记后缀:接口返回了明确信息才标注,未返回由用户自行判断。 */
  const visionSuffix = (v: boolean | null) =>
    v === true ? ` · ${t('common.visionTag')}` : v === false ? ` · ${t('common.noVisionTag')}` : '';
  return (
    <div
      className={s.modelOptions}
      role="listbox"
      aria-label={t('settings.plans.modelsGroup')}
      data-testid={testId}
    >
      {models.map((m) => (
        <button
          key={m.id}
          type="button"
          role="option"
          aria-selected={value === m.id}
          className={s.modelOption}
          data-active={value === m.id || undefined}
          onClick={() => onPick(m.id)}
          title={`${m.id}${visionSuffix(m.supports_vision)}`}
        >
          <span className={s.modelOptionId}>{m.id}</span>
          <span className={s.modelOptionMeta}>
            {m.display_name && m.display_name !== m.id ? m.display_name : ''}
            {visionSuffix(m.supports_vision)}
          </span>
        </button>
      ))}
    </div>
  );
}
