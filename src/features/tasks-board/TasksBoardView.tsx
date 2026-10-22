/**
 * TasksBoard —— Phase 1 多 agent 任务看板。
 *
 * 以两种视图（List / Board）渲染来自 `reflect_list_tasks` 的任务，
 * 支持创建 / 认领 / 推进状态 / 删除，并允许用户选择
 * 活动列表（默认为 "default"；选中团队名时切换为团队列表）。
 * 所有编排逻辑位于 `useTasksBoardController`。
 *
 * 后端契约：`src/utils/commands/{tasks,teams}.ts` ↔
 * `src-tauri/src/commands/tasks.rs`。存储：`~/.reflect/tasks/<list>/` +
 * `~/.reflect/teams/`，与 TUI/CLI 共享。
 */
import { useState } from 'react';
import { KanbanSquare, List as ListIcon, Plus, X, FolderKanban, Users } from 'lucide-react';
import { PageShell } from '@/features/shell/PageShell';
import {
  Card,
  EmptyState,
  Icon,
  SegmentedControl,
  Spinner,
  Tooltip,
  type SegmentedOption,
} from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import {
  STATUS_LABELS,
  useTasksBoardController,
  type BoardView,
} from './useTasksBoardController';
import { TaskRow } from './TaskRow';
import { TaskCreateForm } from './TaskCreateForm';
import { TaskDetail } from './TaskDetail';
import { TeamEditor } from './TeamEditor';
import type { ReflectTaskStatus } from '@/utils/commands';
import s from './TasksBoardView.module.css';

const BOARD_COLUMNS: ReflectTaskStatus[] = ['pending', 'in_progress', 'completed'];

export function TasksBoardView() {
  const ctrl = useTasksBoardController();
  const { t } = useI18n();
  // 视图切换选项是纯图标 —— 必须带 ariaLabel,否则屏幕阅读器读到
  // 「未标记按钮」(axe button-name 违规)。
  const viewOptions: SegmentedOption<BoardView>[] = [
    { value: 'list', label: <Icon icon={ListIcon} size={12} />, ariaLabel: t('tasks.viewList') },
    { value: 'board', label: <Icon icon={KanbanSquare} size={12} />, ariaLabel: t('tasks.viewBoard') },
  ];
  // 自定义列表 ID 输入框可见性（允许用户输入不关联任何 team 的任意列表 ID）。
  const [showListPicker, setShowListPicker] = useState(false);
  // 团队管理面板可见性。
  const [showTeams, setShowTeams] = useState(false);

  return (
    <PageShell
      icon={FolderKanban}
      title={t('tasks.title')}
      subtitle={t('tasks.subtitle')}
      width="lg"
      actions={
        <>
          <SegmentedControl
            size="sm"
            options={viewOptions}
            value={ctrl.view}
            onChange={ctrl.setView}
          />
          <Tooltip label={t('tasks.switchList')} side="bottom">
            <button
              type="button"
              className={s.listBtn}
              onClick={() => setShowListPicker((v) => !v)}
              data-testid="tasks-list-picker-toggle"
            >
              <Icon icon={FolderKanban} size={12} /> {ctrl.listId}
            </button>
          </Tooltip>
          <Tooltip label={t('tasks.teamManager')} side="bottom">
            <button
              type="button"
              className={s.listBtn}
              onClick={() => setShowTeams((v) => !v)}
              data-testid="tasks-team-manager-toggle"
            >
              <Icon icon={Users} size={12} /> {t('tasks.teams')}
            </button>
          </Tooltip>
          <button
            type="button"
            className={s.addBtn}
            onClick={ctrl.toggleShowForm}
            data-testid="tasks-add-btn"
          >
            {ctrl.showForm ? <Icon icon={X} size={12} /> : <Icon icon={Plus} size={12} />}{' '}
            {ctrl.showForm ? t('tasks.cancel') : t('tasks.add')}
          </button>
        </>
      }
    >
      {/* List picker */}
      {showListPicker && (
        <Card level="flat" padding="sm" className={s.listPicker} data-testid="tasks-list-picker">
          <div className={s.listPickerLabel}>{t('tasks.activeList')}</div>
          <input
            className={s.formInput}
            value={ctrl.listId}
            onChange={(e) => ctrl.setListId(e.target.value)}
            data-testid="tasks-list-id-input"
            placeholder={t('tasks.listPlaceholder')}
          />
          {ctrl.teamNames.length > 0 && (
            <>
              <div className={s.listPickerLabel}>{t('tasks.teams')}</div>
              <div className={s.teamChips}>
                {ctrl.teamNames.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={s.teamChip}
                    data-active={ctrl.listId === name || undefined}
                    onClick={() => {
                      ctrl.setListId(name);
                      setShowListPicker(false);
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </>
          )}
        </Card>
      )}

      {/* 团队管理(建 / 改 / 删)—— 核心 `upsert_team` / `delete_team`
          此前只有后端命令,界面里只能「看」不能「改」。 */}
      {showTeams && (
        <TeamEditor
          teams={ctrl.teams}
          onSave={ctrl.upsertTeam}
          onDelete={ctrl.deleteTeam}
          busy={ctrl.teamBusy}
        />
      )}

      {/* Create form */}
      {ctrl.showForm && (
        <TaskCreateForm
          newSubject={ctrl.newSubject}
          newDescription={ctrl.newDescription}
          newOwner={ctrl.newOwner}
          setNewSubject={ctrl.setNewSubject}
          setNewDescription={ctrl.setNewDescription}
          setNewOwner={ctrl.setNewOwner}
          onSubmit={() => void ctrl.create()}
        />
      )}

      {/* Body */}
      {ctrl.loading ? (
        <div className={s.loading}>
          <Spinner size={20} />
        </div>
      ) : ctrl.error ? (
        <Card level="flat" padding="none">
          <EmptyState
            icon={<Icon icon={FolderKanban} />}
            title={t('tasks.failed')}
            description={t('tasks.failedDesc')}
          />
        </Card>
      ) : ctrl.tasks.length === 0 ? (
        <Card level="flat" padding="none">
          <EmptyState
            icon={<Icon icon={FolderKanban} />}
            title={t('tasks.empty')}
            description={t('tasks.emptyDesc', { listId: ctrl.listId })}
          />
        </Card>
      ) : ctrl.view === 'list' ? (
        <div className={s.list} data-testid="tasks-list-view">
          {ctrl.tasks.map((task) => (
            <TaskRow
              key={`${task.list_id}:${task.id}`}
              task={task}
              onClaim={(t) => void ctrl.claim(t)}
              onAdvance={(t, st) => void ctrl.advance(t, st)}
              onRemove={(t) => void ctrl.remove(t)}
              onSelect={ctrl.selectTask}
              onStop={(t) => void ctrl.stop(t)}
              onRelease={(t) => void ctrl.release(t)}
            />
          ))}
        </div>
      ) : (
        <div className={s.board} data-testid="tasks-board-view">
          {BOARD_COLUMNS.map((status) => (
            <div key={status} className={s.boardColumn} data-status={status}>
              <div className={s.boardColumnHeader}>
                {STATUS_LABELS[status]}{' '}
                <span className={s.boardColumnCount}>
                  {ctrl.grouped[status].length}
                </span>
              </div>
              <div className={s.boardColumnBody}>
                {ctrl.grouped[status].length === 0 ? (
                  <div className={s.boardEmpty}>—</div>
                ) : (
                  ctrl.grouped[status].map((task) => (
                    <TaskRow
                      key={`${task.list_id}:${task.id}`}
                      task={task}
                      onClaim={(t) => void ctrl.claim(t)}
                      onAdvance={(t, st) => void ctrl.advance(t, st)}
                      onRemove={(t) => void ctrl.remove(t)}
                      onSelect={ctrl.selectTask}
                      onStop={(t) => void ctrl.stop(t)}
                      onRelease={(t) => void ctrl.release(t)}
                    />
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 任务详情(描述 + 产出)—— 任务板的产出视图。 */}
      {ctrl.selected && (
        <TaskDetail task={ctrl.selected} onClose={() => ctrl.selectTask(null)} />
      )}
    </PageShell>
  );
}
