import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import type { ZhuyeSquadMember, ZhuyeTask } from '@/utils/commands';
import { useI18n } from '@/utils/i18n';
import { Card } from '@/features/design-system';
import { Badge } from '@/features/design-system';
import { Button } from '@/features/design-system';
import { Icon } from '@/features/design-system';
import s from '@/render/squad/SquadView.module.css';

export function SquadTaskRow(props: {
  task: ZhuyeTask;
  members: ZhuyeSquadMember[];
  squadName: string;
  onAssign: (assignee: string | null) => Promise<void>;
}) {
  const { task, members, onAssign } = props;
  const { t } = useI18n();
  const [selected, setSelected] = useState(task.owner ?? '');
  const [busy, setBusy] = useState(false);
  return (
    <Card level="outlined" padding="sm">
      <div className={s.taskRow}>
        <div className={s.taskInfo}>
          <div className={s.taskTitle}>
            #{task.id} {task.subject}
          </div>
          <div className={s.taskMeta}>
            <Badge variant={task.status === 'completed' ? 'success' : task.status === 'in_progress' ? 'info' : 'neutral'}>
              {task.status.replace('_', ' ')}
            </Badge>
            {task.owner && <span> · {t('squad.owner', { name: task.owner })}</span>}
          </div>
        </div>
        <div className={s.taskActions}>
          <select
            value={selected}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelected(e.target.value)}
            className={s.assignSelect}
            data-testid={`squad-assign-${task.id}`}
          >
            <option value="">{t('squad.unassigned')}</option>
            {members.map((m) => (
              <option key={m.actor.actorId} value={m.actor.actorId}>
                {m.role} ({m.actor.actorId})
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || selected === (task.owner ?? '')}
            onClick={async () => {
              setBusy(true);
              try {
                await onAssign(selected || null);
              } finally {
                setBusy(false);
              }
            }}
            data-testid={`squad-assign-btn-${task.id}`}
          >
            <Icon icon={UserPlus} size={12} /> {t('squad.assign')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
