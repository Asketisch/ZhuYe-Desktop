import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { AutopilotBinding } from '@/logic/orchestration/autopilot/AutopilotBinding';
import { AutopilotView as DefaultView } from '@/render/orchestration/autopilot/AutopilotView';

export function AutopilotView() {
  const View = useRenderView('AutopilotView', DefaultView);
  return <AutopilotBinding view={View} />;
}
