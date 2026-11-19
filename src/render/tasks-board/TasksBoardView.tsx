/**
 * TasksBoardView —— 任务看板纯展示视图。
 */
import { KanbanSquare, List as ListIcon, Plus, X, FolderKanban, Users } from 'lucide-react';
import type { BoardView, TaskStatus, TasksBoardViewProps } from '@/contracts/tasksBoard';
import { PageShell } from '../shell/PageShell';
import { Card } from '../design-system/Card';
import { EmptyState } from '../design-system/EmptyState';
import { Icon } from '../design-system/Icon';
import { SegmentedControl } from '../design-system/SegmentedControl';
import { Spinner } from '../design-system/Spinner';
import { Tooltip } from '../design-system/Tooltip';
import { TaskRow } from './TaskRow';
import { TaskCreateForm } from './TaskCreateForm';
import { TaskDetail } from './TaskDetail';
import { TeamEditor } from './TeamEditor';
import s from './TasksBoardView.module.css';

const BOARD_COLUMNS: TaskStatus[] = ['pending', 'in_progress', 'completed'];

export function TasksBoardView(props: TasksBoardViewProps) {
  const { title, subtitle, width, view, onViewChange, listId, onListIdChange, sessions, teamNames, teams, teamBusy, showForm, onToggleForm, newSubject, newDescription, newOwner, onNewSubjectChange, onNewDescriptionChange, onNewOwnerChange, onCreate, tasks, grouped, loading, error, selected, onSelectTask, onClaim, onAdvance, onRemove, onStop, onRelease, labels, statusLabels, showListPicker, onToggleListPicker, onCloseListPicker, showTeams, onToggleTeams, teamEditor, teamLabels } = props;
  const viewOptions = [
    { value: 'list' as BoardView, label: <Icon icon={ListIcon} size={12} />, ariaLabel: labels.viewList },
    { value: 'board' as BoardView, label: <Icon icon={KanbanSquare} size={12} />, ariaLabel: labels.viewBoard },
  ];
  const rowLabels = { claim: labels.claim, start: labels.start, complete: labels.complete, stop: labels.stop, release: labels.release, delete: labels.delete, details: labels.details, claimedBy: labels.claimedBy };

  return (
    <PageShell icon={FolderKanban} title={title} subtitle={subtitle} width={width}
      actions={<>
        <SegmentedControl size="sm" options={viewOptions} value={view} onChange={onViewChange} />
        <Tooltip label={labels.switchList} side="bottom">
          <button type="button" className={s.listBtn} onClick={onToggleListPicker} data-testid="tasks-list-picker-toggle">
            <Icon icon={FolderKanban} size={12} /> {listId}
          </button>
        </Tooltip>
        <Tooltip label={labels.teamManager} side="bottom">
          <button type="button" className={s.listBtn} onClick={onToggleTeams} data-testid="tasks-team-manager-toggle">
            <Icon icon={Users} size={12} /> {labels.teams}
          </button>
        </Tooltip>
        <button type="button" className={s.addBtn} onClick={onToggleForm} data-testid="tasks-add-btn">
          {showForm ? <Icon icon={X} size={12} /> : <Icon icon={Plus} size={12} />} {showForm ? labels.cancel : labels.add}
        </button>
      </>}>
      {showListPicker && (
        <Card level="flat" padding="sm" className={s.listPicker} data-testid="tasks-list-picker">
          <div className={s.listPickerLabel}>{labels.activeList}</div>
          <input className={s.formInput} value={listId} onChange={(e) => onListIdChange(e.target.value)} data-testid="tasks-list-id-input" placeholder={labels.listPlaceholder} />
          {sessions.length > 0 && (<>
            <div className={s.listPickerLabel}>{labels.sessionLists}</div>
            <div className={s.teamChips}>{sessions.map((session) => (
              <button key={session.session_id} type="button" className={s.teamChip} data-active={listId === session.session_id || undefined} title={session.session_id}
                onClick={() => { onListIdChange(session.session_id); onCloseListPicker(); }}>
                {session.title || session.session_id.slice(0, 8)}
              </button>
            ))}</div>
          </>)}
          {teamNames.length > 0 && (<>
            <div className={s.listPickerLabel}>{labels.teams}</div>
            <div className={s.teamChips}>{teamNames.map((name) => (
              <button key={name} type="button" className={s.teamChip} data-active={listId === name || undefined}
                onClick={() => { onListIdChange(name); onCloseListPicker(); }}>{name}</button>
            ))}</div>
          </>)}
        </Card>
      )}

      {showTeams && <TeamEditor teams={teams} editing={teamEditor.editing} name={teamEditor.name} description={teamEditor.description} members={teamEditor.members} busy={teamBusy} error={teamEditor.error}
        onStartCreate={teamEditor.startCreate} onStartEdit={teamEditor.startEdit} onCancel={teamEditor.reset} onNameChange={teamEditor.setName} onDescriptionChange={teamEditor.setDescription}
        onAddMember={teamEditor.addMember} onUpdateMember={teamEditor.updateMember} onRemoveMember={teamEditor.removeMember} onSubmit={() => void teamEditor.submit()}
        onDelete={(name) => void teamEditor.remove(name)} labels={teamLabels} />}

      {showForm && <TaskCreateForm newSubject={newSubject} newDescription={newDescription} newOwner={newOwner} setNewSubject={onNewSubjectChange} setNewDescription={onNewDescriptionChange} setNewOwner={onNewOwnerChange}
        onSubmit={onCreate} labels={{ subject: labels.subject, description: labels.description, owner: labels.owner, create: labels.create }} />}

      {loading ? <div className={s.loading}><Spinner size={20} /></div>
        : error ? <Card level="flat" padding="none"><EmptyState icon={<Icon icon={FolderKanban} />} title={labels.failed} description={labels.failedDesc} /></Card>
        : tasks.length === 0 ? <Card level="flat" padding="none"><EmptyState icon={<Icon icon={FolderKanban} />} title={labels.empty} description={labels.emptyDesc(listId)} /></Card>
        : view === 'list' ? <div className={s.list} data-testid="tasks-list-view">{tasks.map((task) => <TaskRow key={`${task.list_id}:${task.id}`} task={task} labels={rowLabels} statusLabels={statusLabels} onClaim={(x) => void onClaim(x)} onAdvance={(x, st) => void onAdvance(x, st)} onRemove={(x) => void onRemove(x)} onSelect={onSelectTask} onStop={(x) => void onStop(x)} onRelease={(x) => void onRelease(x)} />)}</div>
        : <div className={s.board} data-testid="tasks-board-view">{BOARD_COLUMNS.map((status) => (
            <div key={status} className={s.boardColumn} data-status={status}>
              <div className={s.boardColumnHeader}>{statusLabels[status]} <span className={s.boardColumnCount}>{grouped[status].length}</span></div>
              <div className={s.boardColumnBody}>{grouped[status].length === 0 ? <div className={s.boardEmpty}>—</div> : grouped[status].map((task) => <TaskRow key={`${task.list_id}:${task.id}`} task={task} labels={rowLabels} statusLabels={statusLabels} onClaim={(x) => void onClaim(x)} onAdvance={(x, st) => void onAdvance(x, st)} onRemove={(x) => void onRemove(x)} onSelect={onSelectTask} onStop={(x) => void onStop(x)} onRelease={(x) => void onRelease(x)} />)}</div>
            </div>
          ))}</div>}

      {selected && <TaskDetail task={selected} output={''} outputLoading={false} onClose={() => onSelectTask(null)} labels={{ close: labels.close, detailDescription: labels.detailDescription, detailOutputPath: labels.detailOutputPath, detailOutput: labels.detailOutput, detailOutputEmpty: labels.detailOutputEmpty }} />}
    </PageShell>
  );
}
