/**
 * SuggestionsBody —— 会话内 chips「建议」的内容体。
 *
 * 首页 Hero 四张快捷卡的常驻入口：点击经 `emitComposerPrefill` 预填
 * composer 草稿（不自动发送，保留审阅）。未来升级为工作区感知的动态
 * 建议时，落点在上游 skill 加载链（见 app-core/AGENTS.md 备注）。
 */
import { emitComposerPrefill } from '@/features/composer/useComposerDraft';
import { QUICK_PROMPTS } from '@/logic/home/quickPrompts';
import { useI18n } from '@/utils/i18n';
import s from '@/render/shell/SessionChips.module.css';

export function SuggestionsBody() {
  const { t } = useI18n();
  return (
    <div className={s.body} data-testid="corner-suggestions-body">
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
    </div>
  );
}
