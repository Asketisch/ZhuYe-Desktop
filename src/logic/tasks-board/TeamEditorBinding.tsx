import type { ComponentType } from 'react';
import { useTeamEditor } from './useTeamEditor';
import type { TeamEditorBindingProps, TeamEditorViewProps } from '@/contracts/taskWidgets';
export function TeamEditorBinding({ view: View, teams, onSave, onDelete, busy, error, t }: TeamEditorBindingProps & { view: ComponentType<TeamEditorViewProps> }) {
  const editor = useTeamEditor({ teams, onSave, onDelete, invalidNameMessage: t('tasks.teamNameInvalid') });
  return <View teams={teams} editing={editor.editing} name={editor.name} description={editor.description} members={editor.members}
    busy={busy} error={error ?? editor.error} onStartCreate={editor.startCreate} onStartEdit={editor.startEdit}
    onCancel={editor.reset} onNameChange={editor.setName} onDescriptionChange={editor.setDescription}
    onAddMember={editor.addMember} onUpdateMember={editor.updateMember} onRemoveMember={editor.removeMember}
    onSubmit={() => { void editor.submit(); }} onDelete={(name) => { void editor.remove(name); }}
    labels={{ teamManager: t('tasks.teamManager'), teamCreate: t('tasks.teamCreate'), teamEmpty: t('tasks.teamEmpty'), teamEdit: (name) => t('tasks.teamEdit', { name }), teamMembers: (count) => t('tasks.teamMembers', { count }), teamName: t('tasks.teamName'), teamDescription: t('tasks.teamDescription'), teamAddMember: t('tasks.teamAddMember'), teamMemberRole: t('tasks.teamMemberRole'), teamMemberName: t('tasks.teamMemberName'), teamMemberPrompt: t('tasks.teamMemberPrompt'), teamSave: t('tasks.teamSave'), teamNameInvalid: t('tasks.teamNameInvalid') }} />;
}
