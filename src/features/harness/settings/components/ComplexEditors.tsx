/**
 * 复杂分区编辑器：subagent_models / routing /
 * mcp_servers / lsp_servers / hooks / feature_flags / plugins。
 *
 * 每个编辑器通过 `config/toml.ts` 中的纯辅助函数写回原始 TOML，
 * 使其他位置的未知键保持不变。
 */

import { useMemo } from 'react';
import { Button, Input, Textarea } from '@/features/harness/design-system';
import { useI18n, type LocaleKey } from '@/utils/i18n';
import {
  addFlag,
  addSubSection,
  extractFlags,
  extractSubSections,
  findUnknownSections,
  removeFlag,
  removeSubSection,
  setFlag,
  updateSubSection,
} from '@/logic/harness/settings/config/toml';
import { applyField, readField } from '@/logic/harness/settings/config/schema';
import s from '@/render/harness/settings/SettingsView.module.css';

const COMPLEX_DESCRIPTIONS: Record<string, LocaleKey> = {
  mcp_servers: 'settings.config.section.mcpDesc',
  lsp_servers: 'settings.config.section.lspDesc',
  hooks: 'settings.config.section.hooksDesc',
  routing: 'settings.config.section.routingDesc',
  subagent_models: 'settings.config.section.subagentDesc',
  feature_flags: 'settings.config.section.featureFlagsDesc',
  plugins: 'settings.config.section.pluginsDesc',
};

export function ComplexSection({ section, rawToml, onChange }: { section: string; rawToml: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const sectionTitleKey = `settings.config.section.${section.replace(/_/g, '')}` as LocaleKey;
  return (
    <section className={s.configSection} data-section={section}>
      <h4 className={s.configSectionTitle}>{section}</h4>
      <p className={s.sectionDesc}>{t(COMPLEX_DESCRIPTIONS[section] ?? sectionTitleKey)}</p>
      {section === 'feature_flags' ? (
        <FeatureFlagsEditor rawToml={rawToml} onChange={onChange} />
      ) : section === 'plugins' ? (
        <PluginsEditor rawToml={rawToml} onChange={onChange} />
      ) : (
        <ComplexSectionEditor section={section} rawToml={rawToml} onChange={onChange} />
      )}
    </section>
  );
}

function ComplexSectionEditor({ section, rawToml, onChange }: { section: string; rawToml: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const entries = useMemo(() => extractSubSections(rawToml, section), [rawToml, section]);
  return (
    <div className={s.complexEditor}>
      {entries.length === 0 ? (
        <p className={s.hint}>{t('settings.config.noEntries')}</p>
      ) : (
        entries.map((entry) => (
          <div key={entry.name} className={s.complexEntry}>
            <div className={s.complexEntryHeader}>
              <code className={s.codeInline}>{entry.name}</code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onChange(removeSubSection(rawToml, section, entry.name))}
              >
                {t('settings.config.remove')}
              </Button>
            </div>
            <Textarea
              rows={4}
              spellCheck={false}
              value={entry.body}
              onChange={(e) => onChange(updateSubSection(rawToml, section, entry.name, e.target.value))}
            />
          </div>
        ))
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          onChange(
            // 名称必须带点：addSubSection 对不含点的名称生成裸 `[section]`
            // 头(落入 "(default)" 分区),在默认分区已存在时点击毫无效果。
            addSubSection(rawToml, section, `${section}.${section}-new`),
          )
        }
      >
        {t('settings.config.addEntry', { label: section })}
      </Button>
    </div>
  );
}

function FeatureFlagsEditor({ rawToml, onChange }: { rawToml: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const flags = useMemo(() => extractFlags(rawToml), [rawToml]);
  return (
    <div className={s.complexEditor}>
      {flags.map((flag) => (
        <div key={flag.key} className={s.complexEntry}>
          <code className={s.codeInline}>{flag.key}</code>
          <input
            type="checkbox"
            checked={flag.value}
            aria-label={`Flag ${flag.key}`}
            onChange={(e) => onChange(setFlag(rawToml, flag.key, e.target.checked))}
          />
          <Button size="sm" variant="ghost" onClick={() => onChange(removeFlag(rawToml, flag.key))}>
            {t('settings.config.remove')}
          </Button>
        </div>
      ))}
      <Input
        placeholder="new-flag-key"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const value = (e.target as HTMLInputElement).value.trim();
            if (value) onChange(addFlag(rawToml, value));
            (e.target as HTMLInputElement).value = '';
          }
        }}
      />
    </div>
  );
}

function PluginsEditor({ rawToml, onChange }: { rawToml: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const enabled = readField(rawToml, 'plugins', 'enabled_plugins');
  // 门控型 bundled 插件显式禁用表(上游 0.1.16):写即让对应工具不进注册表
  // (web_search / notebook_edit 消失、tool_search 搜不到)。
  const disabled = readField(rawToml, 'plugins', 'disabled_plugins');
  return (
    <div className={s.complexEditor}>
      <label className={s.fieldLabel} htmlFor="plugins-enabled">{t('settings.config.pluginsLabel')}</label>
      <Textarea
        id="plugins-enabled"
        rows={4}
        value={enabled}
        onChange={(e) => onChange(applyField(rawToml, 'plugins', 'enabled_plugins', e.target.value, 'textarea'))}
      />
      <label className={s.fieldLabel} htmlFor="plugins-disabled">{t('settings.config.pluginsDisabledLabel')}</label>
      <Textarea
        id="plugins-disabled"
        rows={3}
        value={disabled}
        placeholder={t('settings.config.pluginsDisabledPlaceholder')}
        onChange={(e) => onChange(applyField(rawToml, 'plugins', 'disabled_plugins', e.target.value, 'textarea'))}
      />
    </div>
  );
}

export function UnknownSection({ rawToml, knownTopLevel, onChange: _ }: { rawToml: string; knownTopLevel: Set<string>; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const unknown = useMemo(() => findUnknownSections(rawToml, knownTopLevel), [rawToml, knownTopLevel]);
  if (unknown.length === 0) return null;
  return (
    <section className={s.configSection} data-section="unknown">
      <h4 className={s.configSectionTitle}>{t('settings.config.other')}</h4>
      <p className={s.sectionDesc}>
        {t('settings.config.unknownDesc')}
      </p>
      <ul className={s.unknownList}>
        {unknown.map((u) => (
          <li key={u}>{u}</li>
        ))}
      </ul>
    </section>
  );
}