/**
 * TeamEditor —— 团队的建 / 改 / 删。
 *
 * 此前 GUI 只能**列出**团队（任务板的列表选择器里点一下切到某个 team
 * 的任务列表），核心的 `TaskManager::upsert_team` / `delete_team` 只经
 * 后端命令暴露、**没有任何界面入口** —— 用户想加一个团队只能手写
 * `~/.reflect/teams/<name>.json`。
 *
 * 团队是任务系统的协调单元（成员 = agent_id / role / system_prompt），
 * 与 CLI / TUI 共享同一份存储。
 *
 * 口径：
 * - `lead_agent_id` **由前端按核心规则推导**（`team-lead@<name>`）——
 *   核心 `upsert_team` 会校验它不等于推导值就报错，界面不该让用户
 *   手填这个必然量。
 * - 名字规则 `[a-z0-9_-]+`（1..=64）与核心 `validate_team_name` 一致，
 *   前端先拦一道给出即时反馈，后端仍是最终裁决。
 * - 时间字段是核心 `SystemTime` 的 JSON 形态（不是数字）——
 *   见 `ReflectSystemTime`。
 */
import { useState } from 'react';
import { Trash2, Pencil, Plus, Users, X } from 'lucide-react';
import { Badge, Button, Card, Icon, Input, Textarea } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import {
  systemTimeNow,
  type ReflectTeam,
  type ReflectTeamMember,
} from '@/utils/commands';
import s from './TasksBoardView.module.css';

/** 核心 `validate_team_name` 的字符规则。 */
const NAME_RE = /^[a-z0-9_-]{1,64}$/;

/** 核心 `lead_agent_id_for` —— 恒为 `team-lead@<name>`。 */
export function leadAgentIdFor(name: string): string {
  return `team-lead@${name}`;
}

interface MemberDraft {
  /** 临时 key(新增行还没有 agent_id)。 */
  key: string;
  role: string;
  name: string;
  system_prompt: string;
}

function draftFromMember(m: ReflectTeamMember): MemberDraft {
  return {
    key: `${m.agent_id}-${m.role}`,
    role: m.role,
    name: m.name,
    system_prompt: m.system_prompt,
  };
}

export interface TeamEditorProps {
  teams: ReflectTeam[];
  onSave: (team: ReflectTeam) => Promise<void>;
  onDelete: (name: string) => Promise<void>;
  busy?: boolean;
  error?: string | null;
}

export function TeamEditor({ teams, onSave, onDelete, busy, error }: TeamEditorProps) {
  const { t } = useI18n();
  // null = 未展开;`{ name }` = 新建;具体 team = 编辑。
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [members, setMembers] = useState<MemberDraft[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);

  const reset = () => {
    setEditing(null);
    setName('');
    setDescription('');
    setMembers([]);
    setLocalError(null);
  };

  const startCreate = () => {
    setEditing('__new__');
    setName('');
    setDescription('');
    setMembers([]);
    setLocalError(null);
  };

  const startEdit = (team: ReflectTeam) => {
    setEditing(team.name);
    setName(team.name);
    setDescription(team.description ?? '');
    setMembers(team.members.map(draftFromMember));
    setLocalError(null);
  };

  const addMember = () => {
    setMembers((prev) => [
      ...prev,
      { key: `new-${prev.length}-${Date.now()}`, role: 'member', name: '', system_prompt: '' },
    ]);
  };

  const updateMember = (key: string, patch: Partial<MemberDraft>) => {
    setMembers((prev) => prev.map((m) => (m.key === key ? { ...m, ...patch } : m)));
  };

  const removeMember = (key: string) => {
    setMembers((prev) => prev.filter((m) => m.key !== key));
  };

  const submit = async () => {
    const teamName = name.trim();
    if (!NAME_RE.test(teamName)) {
      setLocalError(t('tasks.teamNameInvalid'));
      return;
    }
    const now = systemTimeNow();
    const built: ReflectTeamMember[] = members.map((m) => {
      const role = m.role.trim() || 'member';
      return {
        agent_id: `${role}@${teamName}`,
        name: m.name.trim() || role,
        role,
        model: null,
        system_prompt: m.system_prompt,
        allowed_tools: [],
        color: null,
        joined_at: now,
        session_id: null,
        subscriptions: [],
      };
    });
    // 保留已存在成员的原始 joined_at(编辑场景不覆盖历史)。
    const original = teams.find((x) => x.name === teamName);
    const merged = built.map((m, i) => {
      const prev = original?.members[i];
      return prev && prev.agent_id === m.agent_id ? { ...m, joined_at: prev.joined_at } : m;
    });
    const team: ReflectTeam = {
      name: teamName,
      description: description.trim() || null,
      lead_agent_id: leadAgentIdFor(teamName),
      lead_session_id: null,
      members: merged,
      created_at: original?.created_at ?? now,
    };
    try {
      await onSave(team);
      reset();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (teamName: string) => {
    try {
      await onDelete(teamName);
      if (editing === teamName) reset();
    } catch {
      // 错误由父级的 error 展示。
    }
  };

  return (
    <Card level="flat" padding="sm" className={s.teamPanel} data-testid="tasks-team-editor">
      <div className={s.listPickerLabel}>
        <Icon icon={Users} size={12} /> {t('tasks.teamManager')}
        <Badge variant="neutral">{teams.length}</Badge>
        {editing === null && (
          <Button size="sm" variant="ghost" onClick={startCreate} data-testid="team-create-btn">
            <Icon icon={Plus} size={12} /> {t('tasks.teamCreate')}
          </Button>
        )}
      </div>

      {teams.length === 0 && editing === null && (
        <p className={s.formHint}>{t('tasks.teamEmpty')}</p>
      )}

      <ul className={s.teamList}>
        {teams.map((team) => (
          <li key={team.name} className={s.teamItem} data-testid={`team-item-${team.name}`}>
            <span className={s.teamItemName}>{team.name}</span>
            <span className={s.teamItemMeta}>
              {team.description ? `${team.description} · ` : ''}
              {t('tasks.teamMembers', { count: team.members.length })}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => startEdit(team)}
              data-testid={`team-edit-${team.name}`}
            >
              <Icon icon={Pencil} size={12} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void remove(team.name)}
              data-testid={`team-delete-${team.name}`}
            >
              <Icon icon={Trash2} size={12} />
            </Button>
          </li>
        ))}
      </ul>

      {editing !== null && (
        <div className={s.teamForm} data-testid="team-form">
          <div className={s.listPickerLabel}>
            {editing === '__new__' ? t('tasks.teamCreate') : t('tasks.teamEdit', { name })}
            <Button size="sm" variant="ghost" onClick={reset} data-testid="team-form-cancel">
              <Icon icon={X} size={12} />
            </Button>
          </div>

          <label className={s.formLabel}>
            {t('tasks.teamName')}
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-team"
              data-testid="team-name-input"
              disabled={editing !== '__new__'}
            />
          </label>
          <label className={s.formLabel}>
            {t('tasks.teamDescription')}
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="team-description-input"
            />
          </label>

          <div className={s.listPickerLabel}>
            {t('tasks.teamMembers', { count: members.length })}
            <Button size="sm" variant="ghost" onClick={addMember} data-testid="team-add-member">
              <Icon icon={Plus} size={12} /> {t('tasks.teamAddMember')}
            </Button>
          </div>
          {members.map((m) => (
            <div key={m.key} className={s.teamMemberRow} data-testid="team-member-row">
              <Input
                value={m.role}
                onChange={(e) => updateMember(m.key, { role: e.target.value })}
                placeholder="role"
                aria-label={t('tasks.teamMemberRole')}
                data-testid="team-member-role"
              />
              <Input
                value={m.name}
                onChange={(e) => updateMember(m.key, { name: e.target.value })}
                placeholder="name"
                aria-label={t('tasks.teamMemberName')}
                data-testid="team-member-name"
              />
              <Textarea
                value={m.system_prompt}
                onChange={(e) => updateMember(m.key, { system_prompt: e.target.value })}
                placeholder={t('tasks.teamMemberPrompt')}
                aria-label={t('tasks.teamMemberPrompt')}
                data-testid="team-member-prompt"
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => removeMember(m.key)}
                data-testid="team-member-remove"
              >
                <Icon icon={Trash2} size={12} />
              </Button>
            </div>
          ))}

          {(localError || error) && (
            <p className={s.formError} data-testid="team-form-error">
              {localError ?? error}
            </p>
          )}

          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={() => void submit()}
            data-testid="team-save-btn"
          >
            {t('tasks.teamSave')}
          </Button>
        </div>
      )}
    </Card>
  );
}
