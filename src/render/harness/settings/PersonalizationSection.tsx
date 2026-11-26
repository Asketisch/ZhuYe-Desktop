/**
 * PersonalizationSection —— 个性化分区（纯展示）。
 *
 * 编辑用户级自定义指令（`<用户数据目录>/AGENTS.md`），会话首轮由
 * AgentsMdHook 与项目级合并注入，对所有会话生效。视觉走设置页套件
 * （SettingsPage.module.css）：说明行 + 大编辑框 + 字节计数 + 保存/重置。
 */
import type { SettingsPersonalizationProps } from '@/contracts/settings/settingsPersonalization';
import kit from './SettingsPage.module.css';

export function PersonalizationSection({ t, content, loading, saving, saved, dirty, error, onChange, onSave, onReset }: SettingsPersonalizationProps) {
  const bytes = new TextEncoder().encode(content).length;
  return (
    <div>
      <p className={kit.secDesc}>{t('settingsPage.personalization.desc')}</p>
      <textarea
        className={`${kit.textarea} ${kit.textareaTall}`}
        data-testid="personalization-input"
        value={content}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading}
        spellCheck={false}
        aria-label={t('settingsPage.personalization.label')}
      />
      <div className={kit.personalActions}>
        <span className={kit.badge} data-testid="personalization-bytes">
          {t('settingsPage.personalization.bytes', { count: bytes })}
        </span>
        <span className={kit.grow} />
        {error ? <span className={kit.badge}>{error}</span> : null}
        <button
          type="button"
          className={`${kit.btn} ${kit.ghost}`}
          disabled={!dirty || saving}
          onClick={onReset}
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className={`${kit.btn} ${kit.primary} ${kit.lg}`}
          disabled={!dirty || saving}
          onClick={onSave}
          data-testid="personalization-save"
        >
          {saved ? t('settings.saved') : t('common.save')}
        </button>
      </div>
    </div>
  );
}
