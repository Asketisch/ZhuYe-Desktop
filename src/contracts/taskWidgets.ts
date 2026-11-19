import type { I18nContextValue } from '@/utils/i18n/context';
import type { ReflectTask, ReflectTaskStatus } from '@/utils/commands';
import type { TeamData, TeamMemberDraft } from '@/contracts/tasksBoard';

export interface TaskRowViewProps {
  task: ReflectTask;
  labels: Record<'claim' | 'start' | 'complete' | 'stop' | 'release' | 'delete' | 'details' | 'claimedBy', string>;
  statusLabels: Record<ReflectTaskStatus, string>;
  onClaim: (task: ReflectTask) => void;
  onAdvance: (task: ReflectTask, status: ReflectTaskStatus) => void;
  onRemove: (task: ReflectTask) => void;
  onSelect: (task: ReflectTask) => void;
  onStop: (task: ReflectTask) => void;
  onRelease: (task: ReflectTask) => void;
}
export interface TaskRowBindingProps extends Omit<TaskRowViewProps, 'labels' | 'statusLabels'> { t: I18nContextValue['t'] }

export interface TaskCreateFormViewProps {
  newSubject: string; newDescription: string; newOwner: string;
  setNewSubject: (v: string) => void; setNewDescription: (v: string) => void; setNewOwner: (v: string) => void;
  onSubmit: () => void;
  labels: { subject: string; description: string; owner: string; create: string };
}
export interface TaskCreateFormBindingProps extends Omit<TaskCreateFormViewProps, 'labels'> { t: I18nContextValue['t'] }

export interface TaskDetailViewProps {
  task: ReflectTask; output: string; outputLoading: boolean; onClose: () => void;
  labels: { close: string; detailDescription: string; detailOutputPath: string; detailOutput: string; detailOutputEmpty: string };
}
export interface TaskDetailBindingProps { task: ReflectTask; onClose: () => void; t: I18nContextValue['t'] }

export interface TeamEditorViewProps {
  teams: TeamData[]; editing: string | null; name: string; description: string; members: TeamMemberDraft[];
  busy?: boolean; error?: string | null;
  onStartCreate: () => void; onStartEdit: (team: TeamData) => void; onCancel: () => void;
  onNameChange: (v: string) => void; onDescriptionChange: (v: string) => void; onAddMember: () => void;
  onUpdateMember: (key: string, patch: Partial<TeamMemberDraft>) => void; onRemoveMember: (key: string) => void;
  onSubmit: () => void; onDelete: (name: string) => void;
  labels: { teamManager: string; teamCreate: string; teamEmpty: string; teamEdit: (name: string) => string; teamMembers: (count: number) => string; teamName: string; teamDescription: string; teamAddMember: string; teamMemberRole: string; teamMemberName: string; teamMemberPrompt: string; teamSave: string; teamNameInvalid: string };
}
export interface TeamEditorBindingProps { teams: TeamData[]; onSave: (team: TeamData) => Promise<void>; onDelete: (name: string) => Promise<void>; busy?: boolean; error?: string | null; t: I18nContextValue['t'] }
