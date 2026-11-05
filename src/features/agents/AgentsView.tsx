/**
 * AgentsView —— 阶段 1 任务 3 agent 配置文件管理。
 *
 * 列出 `reflect_list_agent_defs` 的 agent 定义，支持
 * 创建 / 编辑 / 删除。编辑器表单覆盖 name / description /
 * model / system_prompt / tools / disallowed_tools / spawnable / readonly /
 * max_turns / memory scopes。
 *
 * 后端契约：`src/utils/commands/agents.ts` ↔
 * `src-tauri/src/commands/agents.rs` ↔ `zhuye-agent/crates/abilities/zhuye-agent-def`。
 * 存储：`~/.zhuye/agents/<name>.md`，与 TUI/CLI 共享。
 */
import { Bot, Plus, Pencil, Trash2, Check } from 'lucide-react';
import { useState } from 'react';
import { PageShell } from '@/features/shell/PageShell';
import { Badge, Card, EmptyState, Icon, Spinner } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import {
  joinCsv,
  parseCsv,
  useAgentsController,
  type ReflectAgentDef,
} from './useAgentsController';
import { AgentEditor } from './AgentEditor';
import { SubagentSpecsPanel } from './SubagentSpecsPanel';
import s from './AgentsView.module.css';

export function AgentsView() {
  const ctrl = useAgentsController();
  const { t } = useI18n();
  // 两个页签:**agent 定义**(主 agent 的 system prompt / 工具白名单)与
  // **子代理 spec**(`call_<role>` 工具的来源)—— 是两套不同的东西,
  // 此前后者完全没有编辑面。
  const [tab, setTab] = useState<'defs' | 'subagents'>('defs');

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
              onClick={() => setTab('defs')}
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
              onClick={() => setTab('subagents')}
              data-testid="agents-tab-subagents"
            >
              {t('agents.tab.subagents')}
            </button>
          </div>
          {tab === 'defs' && (
            <button
              type="button"
              className={s.addBtn}
              onClick={ctrl.beginCreate}
              disabled={ctrl.isEditing}
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
      {ctrl.activeAgent && (
        <Card level="flat" padding="sm" className={s.activeCard} data-testid="agents-active">
          <div className={s.activeHeader}>
            <span className={s.activeLabel}>{t('agents.active.current')}</span>
            <code className={s.activeName}>{ctrl.activeAgent.name}</code>
            {!ctrl.activeAgent.defFound && (
              <Badge variant="neutral">{t('agents.active.builtin')}</Badge>
            )}
          </div>
          <p className={s.activeMeta}>
            {t('agents.active.memoryScopes')}:{' '}
            {ctrl.activeAgent.memoryScopes.length > 0
              ? ctrl.activeAgent.memoryScopes.join(', ')
              : t('agents.active.noMemoryScopes')}
            {' · '}
            {t('agents.active.budget')}: {ctrl.activeAgent.injectBudgetChars}
          </p>
        </Card>
      )}

      {/* Editor */}
      {ctrl.isEditing && ctrl.draft && (
        <AgentEditor
          draft={ctrl.draft}
          isCreating={ctrl.isCreating}
          isSaving={ctrl.isMutating}
          onPatch={ctrl.patchDraft}
          onSave={() => void ctrl.save()}
          onCancel={ctrl.cancelEdit}
        />
      )}

      {/* List */}
      {ctrl.loading ? (
        <div className={s.loading}>
          <Spinner size={20} />
        </div>
      ) : ctrl.error ? (
        <Card level="flat" padding="none">
          <EmptyState
            icon={<Icon icon={Bot} />}
            title={t('agents.failed')}
            description={t('agents.failedDesc')}
          />
        </Card>
      ) : ctrl.defs.length === 0 && !ctrl.isEditing ? (
        <Card level="flat" padding="none">
          <EmptyState
            icon={<Icon icon={Bot} />}
            title={t('agents.empty')}
            description={t('agents.emptyDesc')}
          />
        </Card>
      ) : (
        <div className={s.list} data-testid="agents-list">
          {ctrl.defs.map((def) => (
            <AgentRow
              key={def.name}
              def={def}
              active={ctrl.activeAgent?.name === def.name}
              switching={ctrl.isSwitchingAgent}
              onActivate={() => void ctrl.setActiveAgent(def.name)}
              onEdit={() => ctrl.beginEdit(def)}
              onRemove={() => void ctrl.remove(def)}
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
  def,
  active,
  switching,
  onActivate,
  onEdit,
  onRemove,
}: {
  def: ReflectAgentDef;
  active: boolean;
  switching: boolean;
  onActivate: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
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

// 为测试方便再导出。
export { joinCsv, parseCsv };
