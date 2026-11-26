import { Bot, Plus, Pencil, Trash2, Check } from 'lucide-react';
import type { AgentsViewProps, ZhuyeAgentDef } from '@/contracts/orchestration/agents';
import { PageShell } from '../shell/PageShell';
import { Spinner } from '../design-system/Spinner';
import kit from '../settings/SettingsPage.module.css';

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
          <div className={kit.seg} role="tablist" aria-label={t('agents.tabs')}>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'defs'}
              className={kit.segBtn}
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
              className={kit.segBtn}
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
              className={`${kit.btn} ${kit.primary}`}
              onClick={onBeginCreate}
              disabled={isEditing}
              data-testid="agents-add-btn"
            >
              <Plus size={12} strokeWidth={1.5} aria-hidden /> {t('agents.new')}
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
        <div className={kit.card} data-testid="agents-active">
          <div className={kit.row}>
            <div className={kit.rowGrid}>
              <div className={kit.rowText}>
                <div className={kit.rowLabel}>{t('agents.active.current')} <code className={`${kit.mono} ${kit.resTitle}`}>{activeAgent.name}</code></div>
                <div className={kit.rowDesc}>
                  {t('agents.active.memoryScopes')}:{' '}
                  {activeAgent.memoryScopes.length > 0
                    ? activeAgent.memoryScopes.join(', ')
                    : t('agents.active.noMemoryScopes')}
                  {' · '}
                  {t('agents.active.budget')}: {activeAgent.injectBudgetChars}
                </div>
              </div>
              <div className={kit.rowCtl}>
                {!activeAgent.defFound && <span className={kit.badge}>{t('agents.active.builtin')}</span>}
              </div>
            </div>
          </div>
        </div>
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
        <div className={kit.emptyBox}>
          <Spinner size={20} />
        </div>
      ) : error ? (
        <div className={kit.notice}>
          <span>{t('agents.failed')}：{t('agents.failedDesc')}</span>
        </div>
      ) : defs.length === 0 && !isEditing ? (
        <div className={kit.emptyBox}>
          {t('agents.empty')} —— {t('agents.emptyDesc')}
        </div>
      ) : (
        <div className={kit.resList} data-testid="agents-list">
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
    <div className={kit.resItem} data-testid={`agent-row-${def.name}`} data-active={active || undefined}>
      <span className={kit.iconTile}><Bot strokeWidth={1.5} aria-hidden /></span>
      <div className={kit.resMain}>
        <div className={kit.titleRow}>
          <code className={`${kit.resTitle} ${kit.mono}`}>{def.name}</code>
          {def.model && <span className={kit.badge} data-fg>{def.model}</span>}
          {def.readonly && <span className={kit.badge}>{t('agents.readonly')}</span>}
          {def.spawnable && <span className={kit.badge} data-fg>{t('agents.spawnable')}</span>}
          {active && <span className={kit.badge} data-fg>{t('agents.active.badge')}</span>}
        </div>
        <div className={kit.resDesc}>{def.description}</div>
      </div>
      <div className={`${kit.resSide} ${kit.sideWrap}`}>
        {!active && (
          <button
            type="button"
            className={`${kit.btn} ${kit.ghost} ${kit.iconOnly}`}
            onClick={onActivate}
            disabled={switching}
            title={t('agents.active.set')}
            data-testid={`agent-activate-${def.name}`}
          >
            <Check strokeWidth={1.5} aria-hidden />
          </button>
        )}
        <button
          type="button"
          className={`${kit.btn} ${kit.ghost} ${kit.iconOnly}`}
          onClick={onEdit}
          title={t('agents.edit')}
          data-testid={`agent-edit-${def.name}`}
        >
          <Pencil strokeWidth={1.5} aria-hidden />
        </button>
        <button
          type="button"
          className={`${kit.btn} ${kit.destructive} ${kit.iconOnly}`}
          onClick={onRemove}
          title={t('agents.delete')}
          data-testid={`agent-delete-${def.name}`}
        >
          <Trash2 strokeWidth={1.5} aria-hidden />
        </button>
      </div>
    </div>
  );
}
