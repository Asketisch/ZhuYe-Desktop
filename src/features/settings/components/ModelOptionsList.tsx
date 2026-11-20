/**
 * 拉取到的模型清单的可点击列表（plan 表单与模型组表单共用）。
 *
 * 显式 listbox 而非 <datalist>：WKWebView(macOS Tauri) 对 datalist
 * 建议下拉支持不可靠，拉取后无任何可选入口。
 *
 * 能力标签（四维：窗口 / 输出 / 视觉 / 思考）：接口或 models.dev 目录
 * 返回了明确信息才标注，null（未知）不标 —— 与 Composer/Models 页的
 * 展示口径一致。
 */
import { useI18n } from '@/utils/i18n';
import { formatTokens } from '@/utils/formatTokens';
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
  /** 点选回调：携带完整条目 —— 调用方据此做联动（如「最大上下文」
   * 留空时一键带入 context_window）。 */
  onPick: (model: ProviderModelInfo) => void;
  testId?: string;
}) {
  const { t } = useI18n();
  /** 能力标记后缀:接口返回了明确信息才标注,未返回由用户自行判断。 */
  const visionSuffix = (v: boolean | null) =>
    v === true ? ` · ${t('common.visionTag')}` : v === false ? ` · ${t('common.noVisionTag')}` : '';

  /** 数值能力标记:窗口 / 输出上限(200K 上下文 · 32K 输出),未披露不标。 */
  const ctxSuffix = (v: number | null) =>
    v != null && v > 0 ? ` · ${formatTokens(v)} ${t('common.ctxTag')}` : '';
  const outSuffix = (v: number | null) =>
    v != null && v > 0 ? ` · ${formatTokens(v)} ${t('common.outTag')}` : '';

  /** 思考能力标记:目录明确表态才标注。 */
  const reasoningSuffix = (v: boolean | null) =>
    v === true ? ` · ${t('common.reasoningTag')}` : v === false ? ` · ${t('common.noReasoningTag')}` : '';

  return (
    <div
      className={s.modelOptions}
      role="listbox"
      aria-label={t('settings.groups.modelsGroup')}
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
          onClick={() => onPick(m)}
          title={`${m.id}${ctxSuffix(m.context_window)}${outSuffix(m.max_output_tokens)}${visionSuffix(m.supports_vision)}${reasoningSuffix(m.supports_reasoning)}`}
        >
          <span className={s.modelOptionId}>{m.id}</span>
          <span className={s.modelOptionMeta}>
            {m.display_name && m.display_name !== m.id ? m.display_name : ''}
            {ctxSuffix(m.context_window)}
            {outSuffix(m.max_output_tokens)}
            {visionSuffix(m.supports_vision)}
            {reasoningSuffix(m.supports_reasoning)}
          </span>
        </button>
      ))}
    </div>
  );
}
