/**
 * TeamEditor —— 团队建改删纯展示组件。
 */
import { Trash2, Pencil, Plus, Users, X } from 'lucide-react';
import { Badge } from '../design-system/Badge';
import { Button } from '../design-system/Button';
import { Card } from '../design-system/Card';
import { Icon } from '../design-system/Icon';
import { Input } from '../design-system/Input';
import { Textarea } from '../design-system/Textarea';
import s from './TasksBoardView.module.css';

import type { TeamEditorViewProps } from '@/contracts/orchestration/taskWidgets';
export function TeamEditor({ teams, editing, name, description, members, busy, error, onStartCreate, onStartEdit, onCancel, onNameChange, onDescriptionChange, onAddMember, onUpdateMember, onRemoveMember, onSubmit, onDelete, labels }: TeamEditorViewProps) {
  return (
    <Card level="flat" padding="sm" className={s.teamPanel} data-testid="tasks-team-editor">
      <div className={s.listPickerLabel}>
        <Icon icon={Users} size={12} /> {labels.teamManager}
        <Badge variant="neutral">{teams.length}</Badge>
        {editing === null && <Button size="sm" variant="ghost" onClick={onStartCreate} data-testid="team-create-btn"><Icon icon={Plus} size={12} /> {labels.teamCreate}</Button>}
      </div>
      {teams.length === 0 && editing === null && <p className={s.formHint}>{labels.teamEmpty}</p>}
      <ul className={s.teamList}>
        {teams.map((team) => (
          <li key={team.name} className={s.teamItem} data-testid={`team-item-${team.name}`}>
            <span className={s.teamItemName}>{team.name}</span>
            <span className={s.teamItemMeta}>{team.description ? `${team.description} · ` : ''}{labels.teamMembers(team.members.length)}</span>
            <Button size="sm" variant="ghost" onClick={() => onStartEdit(team)} data-testid={`team-edit-${team.name}`}><Icon icon={Pencil} size={12} /></Button>
            <Button size="sm" variant="ghost" onClick={() => onDelete(team.name)} data-testid={`team-delete-${team.name}`}><Icon icon={Trash2} size={12} /></Button>
          </li>
        ))}
      </ul>
      {editing !== null && (
        <div className={s.teamForm} data-testid="team-form">
          <div className={s.listPickerLabel}>
            {editing === '__new__' ? labels.teamCreate : labels.teamEdit(name)}
            <Button size="sm" variant="ghost" onClick={onCancel} data-testid="team-form-cancel"><Icon icon={X} size={12} /></Button>
          </div>
          <label className={s.formLabel}>{labels.teamName}
            <Input value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="my-team" data-testid="team-name-input" disabled={editing !== '__new__'} />
          </label>
          <label className={s.formLabel}>{labels.teamDescription}
            <Input value={description} onChange={(e) => onDescriptionChange(e.target.value)} data-testid="team-description-input" />
          </label>
          <div className={s.listPickerLabel}>{labels.teamMembers(members.length)}
            <Button size="sm" variant="ghost" onClick={onAddMember} data-testid="team-add-member"><Icon icon={Plus} size={12} /> {labels.teamAddMember}</Button>
          </div>
          {members.map((m) => (
            <div key={m.key} className={s.teamMemberRow} data-testid="team-member-row">
              <Input value={m.role} onChange={(e) => onUpdateMember(m.key, { role: e.target.value })} placeholder="role" aria-label={labels.teamMemberRole} data-testid="team-member-role" />
              <Input value={m.name} onChange={(e) => onUpdateMember(m.key, { name: e.target.value })} placeholder="name" aria-label={labels.teamMemberName} data-testid="team-member-name" />
              <Textarea value={m.system_prompt} onChange={(e) => onUpdateMember(m.key, { system_prompt: e.target.value })} placeholder={labels.teamMemberPrompt} aria-label={labels.teamMemberPrompt} data-testid="team-member-prompt" />
              <Button size="sm" variant="ghost" onClick={() => onRemoveMember(m.key)} data-testid="team-member-remove"><Icon icon={Trash2} size={12} /></Button>
            </div>
          ))}
          {(error) && <p className={s.formError} data-testid="team-form-error">{error}</p>}
          <Button size="sm" variant="primary" disabled={busy} onClick={onSubmit} data-testid="team-save-btn">{labels.teamSave}</Button>
        </div>
      )}
    </Card>
  );
}
