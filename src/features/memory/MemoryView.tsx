/**
 * Memory —— 持久记忆管理面板 (B11-01).
 *
 * 通过 `reflect_list_memory` / `reflect_add_memory` / `reflect_remove_memory`
 * 与后端同步。支持 scope (global / project / session) 过滤,
 * 内联编辑 + 删除 + 新增表单。
 *
 * 重构于 2026-07-25：查询/变更编排位于 `useMemoryController`；
 * 行和表单渲染位于 `MemoryRow` / `MemoryAddForm`。
 * 本组件用过滤栏和空态/错误/加载状态将它们组合起来。
 */
import { Brain, Plus, X, ShieldAlert } from 'lucide-react';
import { PageShell } from '@/features/shell/PageShell';
import { Card, Icon, EmptyState, Spinner } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { useQuery } from '@tanstack/react-query';
import { reflect_get_active_agent } from '@/utils/commands/agents';
import { reflect_memory_sections } from '@/utils/commands/runtimeStatus';
import {
  FILTERS,
  SCOPE_KEYS,
  entryKey,
  useMemoryController,
} from './useMemoryController';
import { MemoryRow } from './MemoryRow';
import { MemoryAddForm } from './MemoryAddForm';
import { SessionNotes } from './SessionNotes';
import s from './MemoryView.module.css';

export function MemoryView() {
  const { t } = useI18n();
  const ctrl = useMemoryController({ t });

  // 生效的记忆作用域 —— 核心按 agent 定义显式启用记忆;未声明时,这里写
  // 的内容**不会**被注入 system prompt。必须让用户看见,否则 Memory 视图
  // 是个不会生效的编辑器。
  const activeQ = useQuery({
    queryKey: ['active-agent'],
    queryFn: () => reflect_get_active_agent(),
    staleTime: 30_000,
  });
  const scopes = activeQ.data?.memoryScopes ?? [];
  const memoryEnabled = scopes.length > 0;

  // 记忆分段 —— agent 实际注入的是「按 `## ` 切分 + 相关性筛选后」的条目,
  // 不是整份 MEMORY.md 原文。这里给出分段视图,让用户看到 agent 记住了哪几条。
  const sectionsQ = useQuery({
    queryKey: ['memory-sections'],
    queryFn: () => reflect_memory_sections(),
    staleTime: 10_000,
  });
  const sections = sectionsQ.data ?? [];
  const injectBudget = activeQ.data?.injectBudgetChars ?? 0;
  const usedChars = sections.reduce((sum, x) => sum + x.chars, 0);

  return (
    <PageShell
      icon={Brain}
      title={t('memory.title')}
      subtitle={t('memory.subtitle')}
      width="lg"
    >
      {activeQ.data && !memoryEnabled && (
        <Card level="flat" padding="sm" className={s.scopeWarning} data-testid="memory-scope-warning">
          <Icon icon={ShieldAlert} size={12} />
          <span>
            {t('memory.scopeNotDeclared', {
              agent: activeQ.data.name,
              scopes: activeQ.data.memoryScopes.join(', ') || '—',
            })}
          </span>
        </Card>
      )}

      <div className={s.filterBar}>
        {FILTERS.map((sc) => (
          <button
            key={sc}
            type="button"
            className={s.filterBtn}
            data-active={ctrl.filter === sc || undefined}
            onClick={() => ctrl.setFilter(sc)}
            data-testid={`memory-filter-${sc}`}
          >
            {t(SCOPE_KEYS[sc])} <span className={s.count}>{ctrl.counts[sc] ?? 0}</span>
          </button>
        ))}
        <button
          type="button"
          className={s.addBtn}
          onClick={ctrl.toggleShowForm}
          data-testid="memory-add-btn"
        >
          {ctrl.showForm ? <Icon icon={X} size={12} /> : <Icon icon={Plus} size={12} />}{' '}
          {ctrl.showForm ? t('memory.cancel') : t('memory.add')}
        </button>
      </div>

      {ctrl.showForm && (
        <MemoryAddForm
          newScope={ctrl.newScope}
          newKey={ctrl.newKey}
          newValue={ctrl.newValue}
          setNewScope={ctrl.setNewScope}
          setNewKey={ctrl.setNewKey}
          setNewValue={ctrl.setNewValue}
          onSubmit={() => void ctrl.addNew()}
        />
      )}

      {ctrl.loading ? (
        <div className={s.loading}>
          <Spinner size={20} />
        </div>
      ) : ctrl.error ? (
        <Card level="flat" padding="none">
          <EmptyState
            icon={<Icon icon={Brain} />}
            title={t('memory.failed')}
            description={t('memory.failedDesc')}
          />
        </Card>
      ) : ctrl.filtered.length === 0 ? (
        <Card level="flat" padding="none">
          <EmptyState
            icon={<Icon icon={Brain} />}
            title={t('memory.empty')}
            description={t('memory.emptyDesc')}
          />
        </Card>
      ) : (
        <div className={s.list} data-testid="memory-list">
          {ctrl.filtered.map((entry) => {
            const key = entryKey(entry);
            return (
              <MemoryRow
                key={key}
                entry={entry}
                isEditing={ctrl.editingKey === key}
                editValue={ctrl.editValue}
                onEdit={() => ctrl.beginEdit(entry)}
                onChangeEdit={ctrl.setEditValue}
                onSave={() => void ctrl.saveEdit(entry)}
                onCancel={ctrl.cancelEdit}
                onRemove={() => void ctrl.remove(entry)}
              />
            );
          })}
        </div>
      )}

      {/* 会话笔记 —— agent 写下的持久结论(与 memory 的长期记忆互补)。 */}
      <SessionNotes />

      {/* 记忆分段 —— agent 实际注入的条目 + 注入预算占用。 */}
      {sections.length > 0 && (
        <section className={s.notesSection} data-testid="memory-sections">
          <h3 className={s.notesTitle}>
            {t('memory.sections.title')}
            {injectBudget > 0 && (
              <span className={s.notesTitle}>
                {t('memory.sections.budget', {
                  used: usedChars.toLocaleString(),
                  total: injectBudget.toLocaleString(),
                })}
              </span>
            )}
          </h3>
          <ul className={s.notesList}>
            {sections.map((sec, i) => (
              <li key={`${sec.scope}-${sec.index}-${i}`} className={s.noteItem}>
                <span className={s.noteTime}>
                  {sec.scope}
                  {sec.title ? ` · ${sec.title}` : ''}
                </span>
                <span className={s.noteText}>{sec.body}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  );
}
