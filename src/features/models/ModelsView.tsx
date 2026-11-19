import { useRenderView } from '@/logic/renderer/useRenderView';
import { ModelsBinding } from '@/logic/models/ModelsBinding';
import { ModelsView as DefaultView } from '@/render/models/ModelsView';

export function ModelsView() {
  const View = useRenderView('ModelsView', DefaultView);
  return <ModelsBinding view={View} />;
}
