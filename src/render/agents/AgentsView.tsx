import { Bot, Plus, Pencil, Trash2, Check } from 'lucide-react';
import type { AgentsViewProps, ZhuyeAgentDef } from '@/contracts/agents';
import { PageShell } from '../shell/PageShell';
import { Badge } from '../design-system/Badge';
import { Card } from '../design-system/Card';
import { EmptyState } from '../design-system/EmptyState';
import { Icon } from '../design-system/Icon';
import { Spinner } from '../design-system/Spinner';
import s from './AgentsView.module.css';

export function AgentsView({ t, tab, onTabChange, activeAgent, defs, loading, error, isEditing, isMutating,
  isSwitchingAgent, draft, isCreating, onBeginCreate, onBeginEdit, onPatch, onSave, onCancel,
  onActivate, onRemove, AgentEditor, SubagentSpecsPanel }: AgentsViewProps) {
  return (
    <PageShell
      icon={Bot}
      title={t('agents.title')}
      subtitle={t('agents.subtitle')}
      width="lg"
      actions={
        <>
          <div className={s.tabBar} role="tablist" aria-label={t('agents.tabs')}>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'defs'}
              className={s.tab}
              data-active={tab === 'defs' || undefined}
              onClick={() => onTabChange('defs')}
              data-testid="agents-tab-defs"
            >
              {t('agents.tab.defs')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'subagents'}
              className={s.tab}
              data-active={tab === 'subagents' || undefined}
              onClick={() => onTabChange('subagents')}
              data-testid="agents-tab-subagents"
            >
              {t('agents.tab.subagents')}
            </button>
          </div>
          {tab === 'defs' && (
            <button
              type="button"
              className={s.addBtn}
              onClick={onBeginCreate}
              disabled={isEditing}
              data-testid="agents-add-btn"
            >
              <Icon icon={Plus} size={12} /> {t('agents.new')}
            </button>
          )}
        </>
      }
    >
      {tab === 'subagents' ? (
        <SubagentSpecsPanel />
      ) : (
        <>
      {/* 活跃 agent —— 运行时实际加载的那条定义。桌面端此前硬编码 agent
          名,这个视图能编辑定义但运行时永远不加载 —— 现在可以切换。 */}
      {activeAgent && (
        <Card level="flat" padding="sm" className={s.activeCard} data-testid="agents-active">
          <div className={s.activeHeader}>
            <span className={s.activeLabel}>{t('agents.active.current')}</span>
            <code className={s.activeName}>{activeAgent.name}</code>
            {!activeAgent.defFound && (
              <Badge variant="neutral">{t('agents.active.builtin')}</Badge>
            )}
          </div>
          <p className={s.activeMeta}>
            {t('agents.active.memoryScopes')}:{' '}
            {activeAgent.memoryScopes.length > 0
              ? activeAgent.memoryScopes.join(', ')
              : t('agents.active.noMemoryScopes')}
            {' · '}
            {t('agents.active.budget')}: {activeAgent.injectBudgetChars}
          </p>
        </Card>
      )}

      {/* Editor */}
      {isEditing && draft && (
        <AgentEditor
          draft={draft}
          isCreating={isCreating}
          isSaving={isMutating}
          onPatch={onPatch}
          onSave={() => void onSave()}
          onCancel={onCancel}
        />
      )}

      {/* List */}
      {loading ? (
        <div className={s.loading}>
          <Spinner size={20} />
        </div>
      ) : error ? (
        <Card level="flat" padding="none">
          <EmptyState
            icon={<Icon icon={Bot} />}
            title={t('agents.failed')}
            description={t('agents.failedDesc')}
          />
        </Card>
      ) : defs.length === 0 && !isEditing ? (
        <Card level="flat" padding="none">
          <EmptyState
            icon={<Icon icon={Bot} />}
            title={t('agents.empty')}
            description={t('agents.emptyDesc')}
          />
        </Card>
      ) : (
        <div className={s.list} data-testid="agents-list">
          {defs.map((def) => (
            <AgentRow
              key={def.name}
              t={t}
              def={def}
              active={activeAgent?.name === def.name}
              switching={isSwitchingAgent}
              onActivate={() => void onActivate(def.name)}
              onEdit={() => onBeginEdit(def)}
              onRemove={() => void onRemove(def)}
            />
          ))}
        </div>
      )}
        </>
      )}
    </PageShell>
  );
}

function AgentRow({
  t,
  def,
  active,
  switching,
  onActivate,
  onEdit,
  onRemove,
}: {
  def: ZhuyeAgentDef;
  active: boolean;
  switching: boolean;
  onActivate: () => void;
  onEdit: () => void;
  onRemove: () => void;
  t: AgentsViewProps['t'];
}) {
  return (
    <div className={s.row} data-testid={`agent-row-${def.name}`} data-active={active || undefined}>
      <div className={s.rowMain}>
        <code className={s.rowName}>{def.name}</code>
        <span className={s.rowDesc}>{def.description}</span>
        {def.model && <Badge variant="accent">{def.model}</Badge>}
        {def.readonly && <Badge variant="neutral">{t('agents.readonly')}</Badge>}
        {def.spawnable && <Badge variant="success">{t('agents.spawnable')}</Badge>}
        {active && <Badge variant="info">{t('agents.active.badge')}</Badge>}
      </div>
      <div className={s.rowSide}>
        <div className={s.rowActions}>
          {!active && (
            <button
              type="button"
              className={s.actionBtn}
              onClick={onActivate}
              disabled={switching}
              title={t('agents.active.set')}
              data-testid={`agent-activate-${def.name}`}
            >
              <Icon icon={Check} size={12} />
            </button>
          )}
          <button
            type="button"
            className={s.actionBtn}
            onClick={onEdit}
            title={t('agents.edit')}
            data-testid={`agent-edit-${def.name}`}
          >
            <Icon icon={Pencil} size={12} />
          </button>
          <button
            type="button"
            className={`${s.actionBtn} ${s.actionBtnDanger}`}
            onClick={onRemove}
            title={t('agents.delete')}
            data-testid={`agent-delete-${def.name}`}
          >
            <Icon icon={Trash2} size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
