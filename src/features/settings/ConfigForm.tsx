/**
 * ZhuyeConfig 的综合结构化配置表单。
 *
 * 为每个 核心 crate schema 分区的 FieldSpec 渲染一个输入框，
 * 并附带分类的复杂分区编辑器（subagent_models /
 * routing / mcp_servers / lsp_servers / hooks / feature_flags /
 * plugins）。通过 `./config` 中的纯辅助函数读写原始 TOML，
 * 使未知键保持完整，高级 TOML 编辑器仍为高级字段的权威来源。
 */

import { useMemo } from 'react';
import { Button } from '@/features/design-system';
import { useI18n, type LocaleKey } from '@/utils/i18n';
import {
  COMPLEX_SECTIONS,
  SIMPLE_FIELDS_BY_SECTION,
  type FieldSpec,
} from './config/schema';
import { StructuredField } from './components/StructuredField';
import { ComplexSection, UnknownSection } from './components/ComplexEditors';
import s from '@/render/settings/SettingsView.module.css';

const KNOWN_TOML_SECTIONS = new Set(
  Object.keys(SIMPLE_FIELDS_BY_SECTION).concat([...COMPLEX_SECTIONS]),
);

export function ConfigForm({ rawToml, onChange, showSecrets, onToggleSecret }: {
  rawToml: string;
  onChange: (value: string) => void;
  showSecrets: Record<string, boolean>;
  onToggleSecret: (key: string) => void;
}) {
  const { t } = useI18n();
  const sections = useMemo(() => Object.keys(SIMPLE_FIELDS_BY_SECTION), []);
  return (
    <div className={s.configForm}>
      {sections.map((section) => (
        <section key={section} className={s.configSection} data-section={section}>
          <h4 className={s.configSectionTitle}>{section}</h4>
          <div className={s.providerFields}>
            {SIMPLE_FIELDS_BY_SECTION[section].map((field) => {
              const inputId = `config-${field.section}-${field.key}`;
              return (
                <div key={inputId}>
                  <label className={s.fieldLabel} htmlFor={inputId}>{t(field.labelKey as LocaleKey)}</label>
                  <div className={s.configInputRow}>
                    <StructuredField
                      id={inputId}
                      spec={field}
                      toml={rawToml}
                      onChange={onChange}
                      showSecret={showSecrets[inputId] ?? false}
                    />
                    {field.secret ? (
                      <Button size="sm" variant="ghost" onClick={() => onToggleSecret(inputId)}>
                        {(showSecrets[inputId] ?? false) ? t('settings.config.hide') : t('settings.config.show')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {COMPLEX_SECTIONS.map((section) => (
        <ComplexSection key={section} section={section} rawToml={rawToml} onChange={onChange} />
      ))}
      <UnknownSection rawToml={rawToml} knownTopLevel={KNOWN_TOML_SECTIONS} onChange={onChange} />
    </div>
  );
}

export type { FieldSpec };