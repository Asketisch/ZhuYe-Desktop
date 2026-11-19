import { Plus, X, Clock, Power, Trash2 } from 'lucide-react';
import { PageShell } from '../shell/PageShell';
import { Badge } from '../design-system/Badge';
import { Card } from '../design-system/Card';
import { EmptyState } from '../design-system/EmptyState';
import { Icon } from '../design-system/Icon';
import { Spinner } from '../design-system/Spinner';
import type { ScheduleViewProps } from '@/contracts/scheduleView';
import s from './ScheduleView.module.css';

export function ScheduleView({ t, status, showForm, onToggleForm, newSchedule, newPrompt, newName, onNewSchedule, onNewPrompt, onNewName, onSubmitCreate, loading, error, jobs, isMutating, onToggle, onRemove }: ScheduleViewProps) {
  return (
    <PageShell icon={Clock} title={t('schedule.title')} subtitle={t('schedule.subtitle')} width="lg" actions={<>
      {status && <Badge variant={status.status === 'has_jobs' ? 'success' : 'neutral'}>{status.enabled}/{status.total} {t('schedule.active')}</Badge>}
      <button type="button" className={s.addBtn} onClick={onToggleForm} data-testid="schedule-add-btn">{showForm ? <Icon icon={X} size={12} /> : <Icon icon={Plus} size={12} />} {showForm ? t('schedule.cancel') : t('schedule.add')}</button>
    </>}>
      <Card level="outlined" padding="md"><p role="status">{t('schedule.runtimeNotice')}</p></Card>
      {showForm && (
        <form className={s.addForm} data-testid="schedule-create-form" onSubmit={(e) => { e.preventDefault(); onSubmitCreate(); }}>
          <input className={s.formInput} placeholder={t('schedule.cron')} value={newSchedule} onChange={(e) => onNewSchedule(e.target.value)} data-testid="schedule-create-schedule" />
          <input className={s.formInput} placeholder={t('schedule.prompt')} value={newPrompt} onChange={(e) => onNewPrompt(e.target.value)} data-testid="schedule-create-prompt" />
          <input className={s.formInput} placeholder={t('schedule.name')} value={newName} onChange={(e) => onNewName(e.target.value)} data-testid="schedule-create-name" />
          <button type="submit" className={s.saveBtn} disabled={isMutating} data-testid="schedule-create-submit"><Icon icon={Plus} size={12} /> {t('schedule.create')}</button>
        </form>
      )}
      {loading ? <div className={s.loading}><Spinner size={20} /></div>
        : error ? <Card level="flat" padding="none"><EmptyState icon={<Icon icon={Clock} />} title={t('schedule.failed')} description={t('schedule.failedDesc')} /></Card>
        : jobs.length === 0 ? <Card level="flat" padding="none"><EmptyState icon={<Icon icon={Clock} />} title={t('schedule.empty')} description={t('schedule.emptyDesc')} /></Card>
        : <div className={s.list} data-testid="schedule-list">{jobs.map((job) => (
            <div key={job.id} className={s.row} data-testid={`schedule-row-${job.id}`}>
              <div className={s.rowMain}><code className={s.rowSchedule}>{job.schedule}</code><span className={s.rowPrompt}>{job.prompt}</span>{job.next_fire && <span className={s.rowNext} title={t('schedule.nextFire')}>{new Date(job.next_fire).toLocaleString()}</span>}</div>
              <div className={s.rowSide}><Badge variant={job.enabled ? 'success' : 'neutral'}>{job.enabled ? t('schedule.enabled') : t('schedule.disabled')}</Badge>
                <div className={s.rowActions}>
                  <button type="button" className={s.actionBtn} disabled={isMutating} onClick={() => onToggle(job.id)} title={job.enabled ? t('schedule.disable') : t('schedule.enable')} data-testid={`schedule-toggle-${job.id}`}><Icon icon={Power} size={12} /></button>
                  <button type="button" className={`${s.actionBtn} ${s.actionBtnDanger}`} disabled={isMutating} onClick={() => onRemove(job.id)} title={t('schedule.remove')} data-testid={`schedule-remove-${job.id}`}><Icon icon={Trash2} size={12} /></button>
                </div></div>
            </div>
          ))}</div>}
    </PageShell>
  );
}
