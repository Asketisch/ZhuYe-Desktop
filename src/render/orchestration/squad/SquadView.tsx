import { Plus, Users, Trash2, Zap, X } from 'lucide-react';
import type { ZhuyeSquadMember, SquadController, SquadViewProps } from '@/contracts/orchestration/squad';
import { PageShell } from '@/render/harness/shell/PageShell';
import { Card } from '@/render/harness/design-system/Card';
import { Icon } from '@/render/harness/design-system/Icon';
import { EmptyState } from '@/render/harness/design-system/EmptyState';
import { Spinner } from '@/render/harness/design-system/Spinner';
import { Input } from '@/render/harness/design-system/Input';
import { Textarea } from '@/render/harness/design-system/Textarea';
import { Button } from '@/render/harness/design-system/Button';
import { Badge } from '@/render/harness/design-system/Badge';
import s from './SquadView.module.css';

export function SquadView({ t, tp, ctrl, SquadTaskRow }: SquadViewProps) {
  return (
    <PageShell
      icon={Users}
      title={t('squad.title')}
      subtitle={t('squad.subtitle')}
      width="lg"
    >
      <div className={s.layout}>
        {/* ── Left: list + create form ──────────────────────────── */}
        <div className={s.col}>
          <div className={s.section}>
            <h2 className={s.sectionTitle}>{t('squad.squads')}</h2>
            {ctrl.loading ? (
              <div className={s.loading}><Spinner size={20} /></div>
            ) : ctrl.squads.length === 0 ? (
              <Card level="flat" padding="none">
                <EmptyState
                  icon={<Icon icon={Users} />}
                  title={t('squad.empty')}
                  description={t('squad.emptyDesc')}
                />
              </Card>
            ) : (
              <div className={s.list} data-testid="squad-list">
                {ctrl.squads.map((sq) => (
                  <button
                    key={sq.name}
                    type="button"
                    className={s.listItem}
                    data-active={ctrl.selectedName === sq.name || undefined}
                    onClick={() => ctrl.setSelectedName(sq.name)}
                    data-testid={`squad-${sq.name}`}
                  >
                    <div className={s.listName}>{sq.name}</div>
                    <div className={s.listMeta}>
                      {tp('squad.memberCount', sq.members.length)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={s.section}>
            <h2 className={s.sectionTitle}>{t('squad.createSquad')}</h2>
            <Card level="outlined" padding="md">
              <div className={s.form}>
                <Input
                  placeholder={t('squad.namePlaceholder')}
                  value={ctrl.draftName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => ctrl.setDraftName(e.target.value)}
                  data-testid="squad-name"
                />
                <Textarea
                  placeholder={t('squad.descriptionPlaceholder')}
                  value={ctrl.draftDescription}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => ctrl.setDraftDescription(e.target.value)}
                />
                <MemberEditor members={ctrl.draftMembers} onChange={ctrl.setDraftMembers} squadName={ctrl.draftName} t={t} />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void ctrl.create()}
                  disabled={!ctrl.draftName || ctrl.isMutating}
                  data-testid="squad-create"
                >
                  <Icon icon={Plus} size={12} /> {t('squad.create')}
                </Button>
              </div>
            </Card>
          </div>
        </div>

        {/* ── Right: details + tasks + delegate ────────────────── */}
        <div className={s.col}>
          {ctrl.selectedSquad ? (
            <SquadDetail ctrl={ctrl} t={t} SquadTaskRow={SquadTaskRow} />
          ) : (
            <Card level="flat" padding="none">
              <EmptyState
                icon={<Icon icon={Users} />}
                title={t('squad.selectTitle')}
                description={t('squad.selectDesc')}
              />
            </Card>
          )}
        </div>
      </div>
    </PageShell>
  );
}

function SquadDetail({ ctrl, t, SquadTaskRow }: { ctrl: SquadController; t: SquadViewProps['t']; SquadTaskRow: SquadViewProps['SquadTaskRow'] }) {
  const squad = ctrl.selectedSquad!;
  return (
    <div className={s.detail}>
      <div className={s.detailHeader}>
        <h2 className={s.detailName}>{squad.name}</h2>
        <Badge variant="accent">{t('squad.leaderBadge', { id: squad.leaderActor.actorId })}</Badge>
        <div className={s.spacer} />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void ctrl.remove(squad.name)}
          data-testid="squad-delete"
        >
          <Icon icon={Trash2} size={12} /> {t('common.delete')}
        </Button>
      </div>

      {squad.description && <p className={s.desc}>{squad.description}</p>}

      {/* ── Members ────────────────────────────────────────────── */}
      <div className={s.section}>
        <h3 className={s.subsectionTitle}>{t('squad.membersCount', { count: squad.members.length })}</h3>
        {squad.members.length === 0 ? (
          <p className={s.muted}>{t('squad.noMembers')}</p>
        ) : (
          <div className={s.membersList} data-testid="squad-members">
            {squad.members.map((m) => (
              <Card key={m.actor.actorId} level="outlined" padding="sm">
                <div className={s.memberRow}>
                  <div>
                    <div className={s.memberRole}>{m.role}</div>
                    <div className={s.memberId}>{m.actor.actorId}</div>
                  </div>
                  {m.model && <Badge variant="neutral">{m.model}</Badge>}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* ── Delegate / Tasks ──────────────────────────────────── */}
      <div className={s.section}>
        <div className={s.delegateHeader}>
          <h3 className={s.subsectionTitle}>{t('squad.tasksTitle')}</h3>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void ctrl.delegateNext()}
            disabled={ctrl.isMutating}
            data-testid="squad-delegate"
          >
            <Icon icon={Zap} size={12} /> {t('squad.delegateNext')}
          </Button>
        </div>

        {ctrl.squadTasks.length === 0 ? (
          <p className={s.muted}>
            {t('squad.noTasksPrefix')}<code>list_id={squad.name}</code>{t('squad.noTasksSuffix')}
          </p>
        ) : (
          <div className={s.tasksList} data-testid="squad-tasks">
            {ctrl.squadTasks.map((t) => (
              <SquadTaskRow
                key={t.id}
                task={t}
                members={squad.members}
                squadName={squad.name}
                onAssign={async (assignee) => {
                  await ctrl.assignTask(t.id, assignee);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── MemberEditor（用于创建表单）────────────────────────────────

function MemberEditor({ members, onChange, squadName, t }: { members: ZhuyeSquadMember[]; onChange: (ms: ZhuyeSquadMember[]) => void; squadName: string; t: SquadViewProps['t'] }) {
  function addRow() {
    onChange([
      ...members,
      {
        actor: {
          actorType: 'agent',
          actorId: squadName ? `member@${squadName}` : 'member@<squad>',
          kind: 'member',
          displayName: 'member',
          teamName: squadName || '',
        },
        role: 'member',
        model: null,
        systemPrompt: '',
        allowedTools: [],
      },
    ]);
  }
  function updateRole(idx: number, role: string) {
    const next = [...members];
    const clean = role.trim().toLowerCase() || 'member';
    next[idx] = {
      ...next[idx],
      role: clean,
      actor: {
        ...next[idx].actor,
        actorId: squadName ? `${clean}@${squadName}` : next[idx].actor.actorId,
        displayName: clean,
      },
    };
    onChange(next);
  }
  function remove(idx: number) {
    onChange(members.filter((_, i) => i !== idx));
  }
  return (
    <div className={s.memberEditor}>
      {members.map((m, i) => (
        <div key={i} className={s.memberEditorRow}>
          <Input
            placeholder={t('squad.rolePlaceholder')}
            value={m.role}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateRole(i, e.target.value)}
            data-testid={`member-role-${i}`}
          />
          <Button variant="ghost" size="sm" onClick={() => remove(i)}>
            <Icon icon={X} size={12} />
          </Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={addRow} data-testid="member-add">
        <Icon icon={Plus} size={12} /> {t('squad.addMember')}
      </Button>
    </div>
  );
}
