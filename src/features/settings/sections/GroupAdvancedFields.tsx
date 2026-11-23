/**
 * 高级配置字段组 —— responses_api / 超时 / 温度 / 输出上限 / Ollama 三项
 * （GroupDetail 折叠区的正文）。FormState 以类型从 GroupDetail 引入
 * （type-only 循环引用,运行期无环）。
 */
import { Input } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import type { FormState } from './GroupDetail';
import s from '@/render/settings/SettingsView.module.css';

export interface GroupAdvancedFieldsProps {
  form: FormState;
  patch: (p: Partial<FormState>) => void;
}

export function GroupAdvancedFields({ form, patch }: GroupAdvancedFieldsProps) {
  const { t } = useI18n();
  return (
    <>
      <label className={s.fieldHint}>
        <input
          type="checkbox"
          checked={form.responsesApi}
          onChange={(e) => patch({ responsesApi: e.target.checked })}
          disabled={form.endpoint !== 'openai'}
          data-testid="groups-responses-api"
        />{' '}
        {t('settings.groups.responsesApi')}
      </label>
      <div className={s.gFieldTriple}>
        <div className={s.fieldRow}>
          <label className={s.fieldLabel}>{t('settings.groups.timeoutSecs')}</label>
          <Input
            value={form.timeoutSecs}
            onChange={(e) => patch({ timeoutSecs: e.target.value.replace(/[^0-9]/g, '') })}
            placeholder="300"
            inputMode="numeric"
            aria-label={t('settings.groups.timeoutSecs')}
          />
        </div>
        <div className={s.fieldRow}>
          <label className={s.fieldLabel}>{t('settings.groups.temperature')}</label>
          <Input
            value={form.temperature}
            onChange={(e) => patch({ temperature: e.target.value.replace(/[^0-9.]/g, '') })}
            placeholder="0.7"
            inputMode="decimal"
            aria-label={t('settings.groups.temperature')}
          />
        </div>
        <div className={s.fieldRow}>
          <label className={s.fieldLabel}>{t('settings.groups.maxTokens')}</label>
          <Input
            value={form.maxTokens}
            onChange={(e) => patch({ maxTokens: e.target.value.replace(/[^0-9]/g, '') })}
            placeholder="8192"
            inputMode="numeric"
            aria-label={t('settings.groups.maxTokens')}
          />
        </div>
        <div className={s.fieldRow}>
          <label
            className={s.fieldLabel}
            title={t('settings.groups.contextWindowHint')}
          >
            {t('settings.groups.contextWindow')}
          </label>
          <Input
            value={form.contextWindow}
            onChange={(e) => patch({ contextWindow: e.target.value.replace(/[^0-9]/g, '') })}
            placeholder="1000000"
            inputMode="numeric"
            aria-label={t('settings.groups.contextWindow')}
            data-testid="groups-context-window"
          />
        </div>
        <div className={s.fieldRow}>
          <label
            className={s.fieldLabel}
            title={t('settings.groups.autoCompactHint')}
          >
            {t('settings.groups.autoCompact')}
          </label>
          <Input
            value={form.autoCompact}
            onChange={(e) => patch({ autoCompact: e.target.value.replace(/[^0-9.]/g, '') })}
            placeholder="85"
            inputMode="decimal"
            aria-label={t('settings.groups.autoCompact')}
            data-testid="groups-auto-compact"
          />
          <span className={s.fieldHint}>%</span>
        </div>
      </div>
      {form.endpoint === 'ollama' && (
        <div className={s.gFieldTriple}>
          <div className={s.fieldRow}>
            <label className={s.fieldLabel}>{t('settings.groups.keepAliveSecs')}</label>
            <Input
              value={form.keepAliveSecs}
              onChange={(e) => patch({ keepAliveSecs: e.target.value.replace(/[^0-9-]/g, '') })}
              placeholder="300"
              inputMode="numeric"
              aria-label={t('settings.groups.keepAliveSecs')}
            />
          </div>
          <div className={s.fieldRow}>
            <label className={s.fieldLabel}>{t('settings.groups.numCtx')}</label>
            <Input
              value={form.numCtx}
              onChange={(e) => patch({ numCtx: e.target.value.replace(/[^0-9]/g, '') })}
              placeholder="32768"
              inputMode="numeric"
              aria-label={t('settings.groups.numCtx')}
            />
          </div>
          <div className={s.fieldRow}>
            <label className={s.fieldLabel}>{t('settings.groups.numGpu')}</label>
            <Input
              value={form.numGpu}
              onChange={(e) => patch({ numGpu: e.target.value.replace(/[^0-9]/g, '') })}
              placeholder="99"
              inputMode="numeric"
              aria-label={t('settings.groups.numGpu')}
            />
          </div>
        </div>
      )}
    </>
  );
}
