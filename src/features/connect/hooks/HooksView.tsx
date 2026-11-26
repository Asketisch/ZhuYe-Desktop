import { useRenderView } from '@/logic/renderer/useRenderView';
import { HooksBinding } from '@/logic/hooks/HooksBinding';
import { HooksView as DefaultView } from '@/render/hooks/HooksView';

export function HooksView() {
  const View = useRenderView('HooksView', DefaultView);
  return <HooksBinding view={View} />;
}
