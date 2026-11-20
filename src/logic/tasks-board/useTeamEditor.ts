import { useCallback, useState } from 'react';
import { systemTimeNow, type ZhuyeTeam, type ZhuyeTeamMember } from '@/utils/commands';
import type { TeamMemberDraft } from '@/contracts/tasksBoard';

const NAME_RE = /^[a-z0-9_-]{1,64}$/;

/** 核心 `lead_agent_id_for` 的恒等式。 */
export function leadAgentIdFor(name: string): string {
  return `team-lead@${name}`;
}

function draftFromMember(member: ZhuyeTeamMember): TeamMemberDraft {
  return {
    key: `${member.agent_id}-${member.role}`,
    role: member.role,
    name: member.name,
    system_prompt: member.system_prompt,
  };
}

export interface TeamEditorController {
  editing: string | null;
  name: string;
  description: string;
  members: TeamMemberDraft[];
  error: string | null;
  startCreate: () => void;
  startEdit: (team: ZhuyeTeam) => void;
  reset: () => void;
  setName: (value: string) => void;
  setDescription: (value: string) => void;
  addMember: () => void;
  updateMember: (key: string, patch: Partial<TeamMemberDraft>) => void;
  removeMember: (key: string) => void;
  submit: () => Promise<void>;
  remove: (name: string) => Promise<void>;
}

/** 团队编辑器的本地草稿和提交编排。 */
export function useTeamEditor(args: {
  teams: ZhuyeTeam[];
  onSave: (team: ZhuyeTeam) => Promise<void>;
  onDelete: (name: string) => Promise<void>;
  invalidNameMessage: string;
}): TeamEditorController {
  const { teams, onSave, onDelete, invalidNameMessage } = args;
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [members, setMembers] = useState<TeamMemberDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setEditing(null);
    setName('');
    setDescription('');
    setMembers([]);
    setError(null);
  }, []);

  const startCreate = useCallback(() => {
    setEditing('__new__');
    setName('');
    setDescription('');
    setMembers([]);
    setError(null);
  }, []);

  const startEdit = useCallback((team: ZhuyeTeam) => {
    setEditing(team.name);
    setName(team.name);
    setDescription(team.description ?? '');
    setMembers(team.members.map(draftFromMember));
    setError(null);
  }, []);

  const addMember = useCallback(() => {
    setMembers((previous) => [...previous, {
      key: `new-${previous.length}-${Date.now()}`, role: 'member', name: '', system_prompt: '',
    }]);
  }, []);

  const updateMember = useCallback((key: string, patch: Partial<TeamMemberDraft>) => {
    setMembers((previous) => previous.map((member) => member.key === key ? { ...member, ...patch } : member));
  }, []);

  const removeMember = useCallback((key: string) => {
    setMembers((previous) => previous.filter((member) => member.key !== key));
  }, []);

  const submit = useCallback(async () => {
    const teamName = name.trim();
    if (!NAME_RE.test(teamName)) {
      setError(invalidNameMessage);
      return;
    }
    const now = systemTimeNow();
    const built: ZhuyeTeamMember[] = members.map((member) => {
      const role = member.role.trim() || 'member';
      return {
        agent_id: `${role}@${teamName}`,
        name: member.name.trim() || role,
        role,
        model: null,
        system_prompt: member.system_prompt,
        allowed_tools: [],
        color: null,
        joined_at: now,
        session_id: null,
        subscriptions: [],
      };
    });
    const original = teams.find((team) => team.name === teamName);
    const merged = built.map((member, index) => {
      const previous = original?.members[index];
      return previous && previous.agent_id === member.agent_id
        ? { ...member, joined_at: previous.joined_at }
        : member;
    });
    try {
      await onSave({
        name: teamName,
        description: description.trim() || null,
        lead_agent_id: leadAgentIdFor(teamName),
        lead_session_id: null,
        members: merged,
        created_at: original?.created_at ?? now,
      });
      reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [description, invalidNameMessage, members, name, onSave, reset, teams]);

  const remove = useCallback(async (teamName: string) => {
    try {
      await onDelete(teamName);
      if (editing === teamName) reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [editing, onDelete, reset]);

  return { editing, name, description, members, error, startCreate, startEdit, reset,
    setName, setDescription, addMember, updateMember, removeMember, submit, remove };
}
