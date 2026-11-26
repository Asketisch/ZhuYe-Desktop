import { useRenderView } from '@/logic/renderer/useRenderView';
import { ActivityBarBinding } from '@/logic/shell/ActivityBarBinding';
import { ActivityBar as DefaultView } from '@/render/harness/shell/ActivityBar';

export function ActivityBar() {
  const View = useRenderView('ActivityBar', DefaultView);
  return <ActivityBarBinding view={View} />;
}
