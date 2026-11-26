import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { HooksBinding } from '@/logic/connect/hooks/HooksBinding';
import { HooksView as DefaultView } from '@/render/connect/hooks/HooksView';

export function HooksView() {
  const View = useRenderView('HooksView', DefaultView);
  return <HooksBinding view={View} />;
}
