import { useState } from 'react';
import type { ComponentType } from 'react';
import { useI18n } from '@/utils/i18n';
import { useTasksBoardController } from './useTasksBoardController';
import { useTeamEditor } from './useTeamEditor';
import type { TaskStatus, TasksBoardViewProps, TeamData } from '@/contracts/orchestration/tasksBoard';

/** 将任务看板控制器与本地界面状态投影给渲染视图。 */
export function TasksBoardBinding({ view: View }: { view: ComponentType<TasksBoardViewProps> }) {
  const { t } = useI18n();
  const controller = useTasksBoardController();
  const [showListPicker, setShowListPicker] = useState(false);
  const [showTeams, setShowTeams] = useState(false);
  const teamEditor = useTeamEditor({
    teams: controller.teams,
    onSave: controller.upsertTeam,
    onDelete: controller.deleteTeam,
    invalidNameMessage: t('tasks.teamNameInvalid'),
  });
  const statusLabels: Record<TaskStatus, string> = {
    pending: t('tasks.status.pending'),
    in_progress: t('tasks.status.inProgress'),
    completed: t('tasks.status.completed'),
    deleted: t('tasks.status.deleted'),
  };
  const labels: TasksBoardViewProps['labels'] = {
    viewList: t('tasks.viewList'), viewBoard: t('tasks.viewBoard'),
    switchList: t('tasks.switchList'), teamManager: t('tasks.teamManager'),
    teams: t('tasks.teams'), add: t('tasks.add'), cancel: t('tasks.cancel'),
    activeList: t('tasks.activeList'), listPlaceholder: t('tasks.listPlaceholder'),
    sessionLists: t('tasks.sessionLists'), failed: t('tasks.failed'),
    failedDesc: t('tasks.failedDesc'), empty: t('tasks.empty'),
    emptyDesc: (listId) => t('tasks.emptyDesc', { listId }),
    claim: t('tasks.claim'), start: t('tasks.start'), complete: t('tasks.complete'),
    stop: t('tasks.stop'), release: t('tasks.release'), delete: t('tasks.delete'),
    details: t('tasks.details'), claimedBy: t('tasks.claimedBy'),
    subject: t('tasks.subject'), description: t('tasks.description'),
    owner: t('tasks.owner'), create: t('tasks.create'),
    close: t('common.close'), detailDescription: t('tasks.detail.description'),
    detailOutputPath: t('tasks.detail.outputPath'),
    detailOutput: t('tasks.detail.output'), detailOutputEmpty: t('tasks.detail.outputEmpty'),
    teamCreate: t('tasks.teamCreate'),
    teamEdit: (name) => t('tasks.teamEdit', { name }),
    teamEmpty: t('tasks.teamEmpty'), teamName: t('tasks.teamName'),
    teamDescription: t('tasks.teamDescription'), teamSave: t('tasks.teamSave'),
    teamAddMember: t('tasks.teamAddMember'), teamMemberRole: t('tasks.teamMemberRole'),
    teamMemberName: t('tasks.teamMemberName'), teamMemberPrompt: t('tasks.teamMemberPrompt'),
    teamNameInvalid: t('tasks.teamNameInvalid'),
    teamMembers: (count) => t('tasks.teamMembers', { count }),
  };
  return <View
    t={t} title={t('tasks.title')} subtitle={t('tasks.subtitle')} width="lg"
    view={controller.view} onViewChange={controller.setView}
    listId={controller.listId} onListIdChange={controller.setListId}
    sessions={controller.sessions} teamNames={controller.teamNames} teams={controller.teams}
    teamBusy={controller.teamBusy} onTeamSave={controller.upsertTeam} onTeamDelete={controller.deleteTeam}
    showForm={controller.showForm} onToggleForm={controller.toggleShowForm}
    newSubject={controller.newSubject} newDescription={controller.newDescription}
    newOwner={controller.newOwner}
    onNewSubjectChange={controller.setNewSubject}
    onNewDescriptionChange={controller.setNewDescription}
    onNewOwnerChange={controller.setNewOwner}
    onCreate={controller.create} tasks={controller.tasks}
    grouped={controller.grouped as TasksBoardViewProps['grouped']}
    loading={controller.loading} error={controller.error} selected={controller.selected}
    onSelectTask={controller.selectTask} onClaim={controller.claim}
    onAdvance={controller.advance} onRemove={controller.remove}
    onStop={controller.stop} onRelease={controller.release}
    labels={labels} statusLabels={statusLabels}
    showListPicker={showListPicker}
    onToggleListPicker={() => setShowListPicker((visible) => !visible)}
    onCloseListPicker={() => setShowListPicker(false)}
    showTeams={showTeams}
    onToggleTeams={() => setShowTeams((visible) => !visible)}
    teamEditor={{ ...teamEditor, startEdit: (team: TeamData) => teamEditor.startEdit(team) }}
    teamLabels={{
      teamManager: t('tasks.teamManager'), teamCreate: t('tasks.teamCreate'),
      teamEmpty: t('tasks.teamEmpty'), teamEdit: (name) => t('tasks.teamEdit', { name }),
      teamMembers: (count) => t('tasks.teamMembers', { count }),
      teamName: t('tasks.teamName'), teamDescription: t('tasks.teamDescription'),
      teamAddMember: t('tasks.teamAddMember'), teamMemberRole: t('tasks.teamMemberRole'),
      teamMemberName: t('tasks.teamMemberName'), teamMemberPrompt: t('tasks.teamMemberPrompt'),
      teamSave: t('tasks.teamSave'), teamNameInvalid: t('tasks.teamNameInvalid'),
    }}
  />;
}
