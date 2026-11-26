import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { PlanBinding } from '@/logic/orchestration/plan/PlanBinding';
import { PlanView as DefaultView } from '@/render/orchestration/plan/PlanView';
import { Markdown } from '@/components/Markdown';

export function PlanView() {
  const View = useRenderView('PlanView', DefaultView);
  return <PlanBinding view={View} slots={{ Markdown }} />;
}
