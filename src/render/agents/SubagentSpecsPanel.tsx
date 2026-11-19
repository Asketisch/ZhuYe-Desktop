import { Bot, Plus, Trash2, Save, X } from 'lucide-react';
import type { SubagentSpecsViewProps } from '@/contracts/agentWidgets';
import { Badge } from '../design-system/Badge';
import { Button } from '../design-system/Button';
import { Card } from '../design-system/Card';
import { EmptyState } from '../design-system/EmptyState';
import { Icon } from '../design-system/Icon';
import { Spinner } from '../design-system/Spinner';
import s from './AgentsView.module.css';

export function SubagentSpecsPanel({ t, specs, loading, editing, savePending, saveError, onOpenEditor, onCancelEditor, onChangeMarkdown, onSave, onDelete }: SubagentSpecsViewProps) {
  return (
    <div data-testid="agents-subagent-specs">
      {editing && (
        <Card level="flat" padding="sm" className={s.specEditor} data-testid="subagent-editor">
          <div className={s.specEditorHeader}>
            <code className={s.specRole}>{editing.role}</code>
            <Button
              size="sm"
              variant="ghost"
              onClick={onCancelEditor}
              data-testid="subagent-editor-cancel"
            >
              <Icon icon={X} size={12} /> {t('agents.subagents.cancel')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={savePending}
              onClick={onSave}
              data-testid="subagent-editor-save"
            >
              <Icon icon={Save} size={12} /> {t('agents.subagents.save')}
            </Button>
          </div>
          <textarea
            className={s.specTextarea}
            value={editing.markdown}
            onChange={(e) => onChangeMarkdown(e.target.value)}
            spellCheck={false}
            aria-label={t('agents.subagents.markdown')}
            data-testid="subagent-editor-textarea"
          />
          {Boolean(saveError) && (
            <p className={s.specError} data-testid="subagent-editor-error">
              {saveError ?? ''}
            </p>
          )}
        </Card>
      )}

      {loading ? (
        <div className={s.loading}>
          <Spinner size={18} />
        </div>
      ) : specs.length === 0 ? (
        <Card level="flat" padding="none">
          <EmptyState
            size="sm"
            icon={<Icon icon={Bot} />}
            title={t('agents.subagents.empty')}
            description={t('agents.subagents.emptyHint')}
          />
        </Card>
      ) : (
        <div className={s.list} data-testid="subagent-spec-list">
          {specs.map((spec) => (
            <div key={spec.role} className={s.row} data-testid={`subagent-row-${spec.role}`}>
              <div className={s.rowMain}>
                <code className={s.rowName}>{spec.role}</code>
                <span className={s.rowDesc}>{spec.name}</span>
                <Badge variant="neutral">{spec.source}</Badge>
                {spec.model && <Badge variant="accent">{spec.model}</Badge>}
                {spec.allowedTools.length > 0 && (
                  <span className={s.rowDesc}>{spec.allowedTools.join(', ')}</span>
                )}
              </div>
              <div className={s.rowSide}>
                <div className={s.rowActions}>
                  <button
                    type="button"
                    className={s.actionBtn}
                    onClick={() => onOpenEditor(spec.role)}
                    title={t('agents.subagents.edit')}
                    data-testid={`subagent-edit-${spec.role}`}
                  >
                    <Icon icon={Plus} size={12} />
                  </button>
                  {spec.source === 'workspace' && (
                    <button
                      type="button"
                      className={`${s.actionBtn} ${s.actionBtnDanger}`}
                      onClick={() => onDelete(spec.role)}
                      title={t('agents.subagents.delete')}
                      data-testid={`subagent-delete-${spec.role}`}
                    >
                      <Icon icon={Trash2} size={12} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
