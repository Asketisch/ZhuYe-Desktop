import type { ComponentType } from 'react';
import { useI18n } from '@/utils/i18n';
import { useScheduleController } from '@/logic/orchestration/schedule/useScheduleController';
import type { ScheduleViewProps } from '@/contracts/orchestration/scheduleView';

/** 定时任务页面绑定。 */
export function ScheduleBinding({ view: View }: { view: ComponentType<ScheduleViewProps> }) {
  const ctrl = useScheduleController();
  const { t } = useI18n();
  return (
    <View
      t={t}
      status={ctrl.status ? { enabled: ctrl.status.enabled, total: ctrl.status.total, status: ctrl.status.status } : null}
      showForm={ctrl.showForm}
      onToggleForm={ctrl.toggleShowForm}
      newSchedule={ctrl.newSchedule}
      newPrompt={ctrl.newPrompt}
      newName={ctrl.newName}
      onNewSchedule={ctrl.setNewSchedule}
      onNewPrompt={ctrl.setNewPrompt}
      onNewName={ctrl.setNewName}
      onSubmitCreate={() => void ctrl.create()}
      loading={ctrl.loading}
      error={ctrl.error}
      jobs={ctrl.jobs.map((job) => ({ id: job.id, schedule: job.schedule, prompt: job.prompt, name: job.name, enabled: job.enabled, next_fire: job.next_fire ?? null }))}
      isMutating={ctrl.isMutating}
      onToggle={(id) => { const job = ctrl.jobs.find((j) => j.id === id); if (job) void ctrl.toggle(job); }}
      onRemove={(id) => { const job = ctrl.jobs.find((j) => j.id === id); if (job) void ctrl.remove(job); }}
    />
  );
}
