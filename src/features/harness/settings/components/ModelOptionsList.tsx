/**
 * 拉取到的模型清单的可点击列表（plan 表单与模型组表单共用）。
 *
 * 显式 listbox 而非 <datalist>：WKWebView(macOS Tauri) 对 datalist
 * 建议下拉支持不可靠，拉取后无任何可选入口。
 *
 * 能力徽标（四维：窗口 / 输出 / 视觉 / 思考）：接口或 models.dev 目录
 * 返回了明确信息才标注，null（未知）不标 —— 与 Composer/Models 页的
 * 展示口径一致。选中行高亮 + 对勾。
 */
import { Check } from 'lucide-react';
import { Icon } from '@/features/harness/design-system';
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

  /** 能力徽标:接口返回了明确信息才标注,未返回(null)不标。 */
  const tagsOf = (m: ProviderModelInfo): string[] => {
    const tags: string[] = [];
    if (m.context_window != null && m.context_window > 0) {
      tags.push(`${formatTokens(m.context_window)} ${t('common.ctxTag')}`);
    }
    if (m.max_output_tokens != null && m.max_output_tokens > 0) {
      tags.push(`${formatTokens(m.max_output_tokens)} ${t('common.outTag')}`);
    }
    if (m.supports_vision === true) tags.push(t('common.visionTag'));
    if (m.supports_vision === false) tags.push(t('common.noVisionTag'));
    if (m.supports_reasoning === true) tags.push(t('common.reasoningTag'));
    if (m.supports_reasoning === false) tags.push(t('common.noReasoningTag'));
    // 思考档位枚举（models.dev reasoning_options 投票）：不同提供方枚举
    // 不同（minimal/low/high、none/medium/xhigh…）—— 列在徽标里让用户
    // 知道该模型可选哪些档；档位词直接显示英文原词。
    if (m.effort_levels && m.effort_levels.length > 0) {
      tags.push(`${t('common.effortTag')}: ${m.effort_levels.join('/')}`);
    }
    return tags;
  };

  return (
    <div
      className={s.modelOptions}
      role="listbox"
      aria-label={t('settings.groups.modelsGroup')}
      data-testid={testId}
    >
      {models.map((m) => {
        const tags = tagsOf(m);
        return (
          <button
            key={m.id}
            type="button"
            role="option"
            aria-selected={value === m.id}
            className={s.modelOption}
            data-active={value === m.id || undefined}
            onClick={() => onPick(m)}
            title={`${m.id} · ${tags.join(' · ')}`}
          >
            <span className={s.modelOptionMain}>
              <span className={s.modelOptionId}>{m.id}</span>
              {m.display_name && m.display_name !== m.id && (
                <span className={s.modelOptionMeta}>{m.display_name}</span>
              )}
            </span>
            <span className={s.modelOptionTags}>
              {tags.map((tag) => (
                <span key={tag} className={s.modelOptionTag}>
                  {tag}
                </span>
              ))}
              {value === m.id && <Icon icon={Check} size={12} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
