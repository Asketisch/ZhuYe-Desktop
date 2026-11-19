import { useRenderView } from '@/logic/renderer/useRenderView';
import { PlanBinding } from '@/logic/plan/PlanBinding';
import { PlanView as DefaultView } from '@/render/plan/PlanView';

export function PlanView() {
  const View = useRenderView('PlanView', DefaultView);
  return <PlanBinding view={View} />;
}
