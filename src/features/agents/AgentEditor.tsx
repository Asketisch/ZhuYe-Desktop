/**
 * AgentEditor —— AgentDefinition 的创建/编辑表单。
 *
 * 纯展示组件；状态位于 `useAgentsController.draft` + `patchDraft`。
 * 覆盖除 `mcp_collections`（v1 保留）外的所有 `AgentDefinition` 字段。
 */
import { Save, X } from 'lucide-react';
import { Card, Icon, Textarea, Input } from '@/features/design-system';
import type { ReflectAgentDef, ReflectMemoryScope } from '@/utils/commands';
import { joinCsv, parseCsv } from './useAgentsController';
import { useI18n } from '@/utils/i18n';
import s from './AgentsView.module.css';

const MEMORY_SCOPES: ReflectMemoryScope[] = ['project', 'user', 'session'];

export interface AgentEditorProps {
  draft: ReflectAgentDef;
  isCreating: boolean;
  isSaving: boolean;
  onPatch: (patch: Partial<ReflectAgentDef>) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function AgentEditor({ draft, isCreating, isSaving, onPatch, onSave, onCancel }: AgentEditorProps) {
  const { t } = useI18n();
  return (
    <Card level="outlined" padding="md" className={s.editor} data-testid="agent-editor">
      <div className={s.editorHeader}>
        <strong>{isCreating ? t('agents.newAgent') : t('agents.editAgent', { name: draft.name })}</strong>
        <div className={s.editorActions}>
          <button
            type="button"
            className={s.actionBtn}
            onClick={onCancel}
            data-testid="agent-editor-cancel"
          >
            <Icon icon={X} size={12} /> {t('agents.cancel')}
          </button>
          <button
            type="button"
            className={s.saveBtn}
            onClick={onSave}
            disabled={isSaving}
            data-testid="agent-editor-save"
          >
            <Icon icon={Save} size={12} /> {t('agents.save')}
          </button>
        </div>
      </div>

      <form
        className={s.editorForm}
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <label className={s.fieldLabel}>
          {t('agents.name')} <span className={s.required}>*</span>
          <Input
            value={draft.name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onPatch({ name: e.target.value })}
            placeholder={t('agents.namePlaceholder')}
            data-testid="agent-editor-name"
            disabled={!isCreating || isSaving}
          />
        </label>

        <label className={s.fieldLabel}>
          {t('agents.description')} <span className={s.required}>*</span>
          <Input
            value={draft.description}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onPatch({ description: e.target.value })}
            placeholder={t('agents.descriptionPlaceholder')}
            data-testid="agent-editor-description"
          />
        </label>

        <label className={s.fieldLabel}>
          {t('agents.model')}
          <Input
            value={draft.model ?? ''}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onPatch({ model: e.target.value || null })}
            placeholder={t('agents.modelPlaceholder')}
            data-testid="agent-editor-model"
          />
        </label>

        <label className={s.fieldLabel}>
          {t('agents.toolsLabel')}
          <Input
            value={joinCsv(draft.tools ?? [])}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onPatch({ tools: parseCsv(e.target.value) })}
            placeholder={t('agents.toolsPlaceholder')}
            data-testid="agent-editor-tools"
          />
        </label>

        <label className={s.fieldLabel}>
          {t('agents.disallowedToolsLabel')}
          <Input
            value={joinCsv(draft.disallowed_tools ?? [])}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onPatch({ disallowed_tools: parseCsv(e.target.value) })}
            placeholder={t('agents.disallowedToolsPlaceholder')}
            data-testid="agent-editor-disallowed-tools"
          />
        </label>

        <label className={s.fieldLabel}>
          <input
            type="checkbox"
            checked={!!draft.spawnable}
            onChange={(e) => onPatch({ spawnable: e.target.checked })}
            data-testid="agent-editor-spawnable"
          />
          {t('agents.spawnableLabel')}
        </label>

        <label className={s.fieldLabel}>
          <input
            type="checkbox"
            checked={!!draft.readonly}
            onChange={(e) => onPatch({ readonly: e.target.checked })}
            data-testid="agent-editor-readonly"
          />
          {t('agents.readonlyLabel')}
        </label>

        <label className={s.fieldLabel}>
          {t('agents.maxTurns')}
          <span className={s.hint}>
            {draft.max_turns != null ? draft.max_turns : t('agents.unset')}
          </span>
          <input
            type="range"
            min={0}
            max={99}
            step={1}
            value={draft.max_turns ?? 99}
            onChange={(e) => onPatch({ max_turns: Number(e.target.value) })}
            data-testid="agent-editor-max-turns"
          />
        </label>

        <label className={s.fieldLabel}>
          {t('agents.memoryScopes')}
          <div className={s.scopeRow}>
            {MEMORY_SCOPES.map((sc) => (
              <label key={sc} className={s.scopeItem}>
                <input
                  type="checkbox"
                  checked={(draft.memory ?? [])?.includes(sc) || false}
                  onChange={(e) => {
                    const scopes = [...(draft.memory ?? [])];
                    if (e.target.checked) {
                      onPatch({ memory: scopes.includes(sc) ? scopes : [...scopes, sc] });
                    } else {
                      onPatch({ memory: scopes.filter((s) => s !== sc) });
                    }
                  }}
                  data-testid={`agent-editor-scope-${sc}`}
                />
                {sc}
              </label>
            ))}
          </div>
        </label>

        <label className={s.fieldLabel}>
          {t('agents.systemPromptLabel')}
          <Textarea
            value={draft.system_prompt}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onPatch({ system_prompt: e.target.value })}
            rows={8}
            placeholder={t('agents.systemPromptPlaceholder')}
            data-testid="agent-editor-system-prompt"
          />
        </label>

        {/* Hidden submit so Enter triggers save */}
        <button type="submit" style={{ display: 'none' }} />
      </form>
    </Card>
  );
}
