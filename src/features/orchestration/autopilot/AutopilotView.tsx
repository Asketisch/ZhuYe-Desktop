import { useRenderView } from '@/logic/renderer/useRenderView';
import { AutopilotBinding } from '@/logic/autopilot/AutopilotBinding';
import { AutopilotView as DefaultView } from '@/render/orchestration/autopilot/AutopilotView';

export function AutopilotView() {
  const View = useRenderView('AutopilotView', DefaultView);
  return <AutopilotBinding view={View} />;
}
