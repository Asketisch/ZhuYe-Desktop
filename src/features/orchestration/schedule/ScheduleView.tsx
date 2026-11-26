import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { ScheduleBinding } from '@/logic/orchestration/schedule/ScheduleBinding';
import { ScheduleView as DefaultView } from '@/render/orchestration/schedule/ScheduleView';

export function ScheduleView() {
  const View = useRenderView('ScheduleView', DefaultView);
  return <ScheduleBinding view={View} />;
}
