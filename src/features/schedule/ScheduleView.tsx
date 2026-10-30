/**
 * ScheduleView —— Phase 1 条目 2 cron 定时任务 UI。
 *
 * 从 `reflect_list_schedules` 渲染 cron 任务，支持添加 / 切换 /
 * 移除，并显示调度器状态徽标。编排逻辑位于
 * `useScheduleController`。
 *
 * 后端契约：`src/utils/commands/schedule.ts` ↔
 * `src-tauri/src/commands/schedule.rs` ↔ `reflect-agent/crates/integrations/reflect-stream::cron`。
 * 驱动程序（30 秒 tick）通过将到期任务的 prompt 作为
 * `Submission::user_input` 注入 agent 循环来触发执行。
 */
import { Plus, X, Clock, Power, Trash2 } from 'lucide-react';
import { PageShell } from '@/features/shell/PageShell';
import { Badge, Card, EmptyState, Icon, Spinner } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { useScheduleController } from './useScheduleController';
import s from './ScheduleView.module.css';

export function ScheduleView() {
  const ctrl = useScheduleController();
  const { t } = useI18n();

  return (
    <PageShell
      icon={Clock}
      title={t('schedule.title')}
      subtitle={t('schedule.subtitle')}
      width="lg"
      actions={
        <>
          {ctrl.status && (
            <Badge
              variant={ctrl.status.status === 'has_jobs' ? 'success' : 'neutral'}
            >
              {ctrl.status.enabled}/{ctrl.status.total} {t('schedule.active')}
            </Badge>
          )}
          <button
            type="button"
            className={s.addBtn}
            onClick={ctrl.toggleShowForm}
            data-testid="schedule-add-btn"
          >
            {ctrl.showForm ? <Icon icon={X} size={12} /> : <Icon icon={Plus} size={12} />}{' '}
            {ctrl.showForm ? t('schedule.cancel') : t('schedule.add')}
          </button>
        </>
      }
    >
      <Card level="outlined" padding="md"><p role="status">{t('schedule.runtimeNotice')}</p></Card>
      {/* Create form */}
      {ctrl.showForm && (
        <form
          className={s.addForm}
          data-testid="schedule-create-form"
          onSubmit={(e) => {
            e.preventDefault();
            void ctrl.create();
          }}
        >
          <input
            className={s.formInput}
            placeholder={t('schedule.cron')}
            value={ctrl.newSchedule}
            onChange={(e) => ctrl.setNewSchedule(e.target.value)}
            data-testid="schedule-create-schedule"
          />
          <input
            className={s.formInput}
            placeholder={t('schedule.prompt')}
            value={ctrl.newPrompt}
            onChange={(e) => ctrl.setNewPrompt(e.target.value)}
            data-testid="schedule-create-prompt"
          />
          <input
            className={s.formInput}
            placeholder={t('schedule.name')}
            value={ctrl.newName}
            onChange={(e) => ctrl.setNewName(e.target.value)}
            data-testid="schedule-create-name"
          />
          <button type="submit" className={s.saveBtn} disabled={ctrl.isMutating} data-testid="schedule-create-submit">
            <Icon icon={Plus} size={12} /> {t('schedule.create')}
          </button>
        </form>
      )}

      {/* Body */}
      {ctrl.loading ? (
        <div className={s.loading}>
          <Spinner size={20} />
        </div>
      ) : ctrl.error ? (
        <Card level="flat" padding="none">
          <EmptyState
            icon={<Icon icon={Clock} />}
            title={t('schedule.failed')}
            description={t('schedule.failedDesc')}
          />
        </Card>
      ) : ctrl.jobs.length === 0 ? (
        <Card level="flat" padding="none">
          <EmptyState
            icon={<Icon icon={Clock} />}
            title={t('schedule.empty')}
            description={t('schedule.emptyDesc')}
          />
        </Card>
      ) : (
        <div className={s.list} data-testid="schedule-list">
          {ctrl.jobs.map((job) => (
            <div key={job.id} className={s.row} data-testid={`schedule-row-${job.id}`}>
              <div className={s.rowMain}>
                <code className={s.rowSchedule}>{job.schedule}</code>
                <span className={s.rowPrompt}>{job.prompt}</span>
                {job.next_fire && (
                  <span className={s.rowNext} title={t('schedule.nextFire')}>
                    {new Date(job.next_fire).toLocaleString()}
                  </span>
                )}
              </div>
              <div className={s.rowSide}>
                <Badge variant={job.enabled ? 'success' : 'neutral'}>
                  {job.enabled ? t('schedule.enabled') : t('schedule.disabled')}
                </Badge>
                <div className={s.rowActions}>
                  <button
                    type="button"
                    className={s.actionBtn}
                    disabled={ctrl.isMutating}
                    onClick={() => void ctrl.toggle(job)}
                    title={job.enabled ? t('schedule.disable') : t('schedule.enable')}
                    data-testid={`schedule-toggle-${job.id}`}
                  >
                    <Icon icon={Power} size={12} />
                  </button>
                  <button
                    type="button"
                    className={`${s.actionBtn} ${s.actionBtnDanger}`}
                    disabled={ctrl.isMutating}
                    onClick={() => void ctrl.remove(job)}
                    title={t('schedule.remove')}
                    data-testid={`schedule-remove-${job.id}`}
                  >
                    <Icon icon={Trash2} size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
}
