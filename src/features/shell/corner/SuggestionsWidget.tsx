/**
 * SuggestionsWidget —— 右上角任务建议。
 *
 * 首页 Hero 四张快捷卡的常驻入口：点击经 `emitComposerPrefill` 预填
 * composer 草稿（不自动发送，保留审阅）。未来升级为工作区感知的动态
 * 建议时，落点在上游 skill 加载链（见 app-core/AGENTS.md 备注）。
 */
import { Lightbulb } from 'lucide-react';
import { emitComposerPrefill } from '@/features/composer/useComposerDraft';
import { QUICK_PROMPTS } from '@/logic/home/quickPrompts';
import { useI18n } from '@/utils/i18n';
import { CornerWidget } from './CornerWidget';
import s from '@/render/shell/CornerWidgets.module.css';

export function SuggestionsWidget() {
  const { t } = useI18n();
  return (
    <CornerWidget testId="suggestions" icon={<Lightbulb size={13} />} label={t('harness.corner.suggestions.title')}>
      <ul className={s.suggestionList} data-testid="corner-suggestions-list">
        {QUICK_PROMPTS.map((prompt) => (
          <li key={prompt.id}>
            <button
              type="button"
              className={s.suggestionBtn}
              onClick={() => emitComposerPrefill(t(prompt.promptKey))}
              data-testid={`corner-suggestion-${prompt.id}`}
            >
              <b>{t(prompt.titleKey)}</b>
              <span>{t(prompt.promptKey)}</span>
            </button>
          </li>
        ))}
      </ul>
    </CornerWidget>
  );
}
