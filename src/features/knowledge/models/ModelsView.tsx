import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { ModelsBinding } from '@/logic/knowledge/models/ModelsBinding';
import { ModelsView as DefaultView } from '@/render/knowledge/models/ModelsView';

export function ModelsView() {
  const View = useRenderView('ModelsView', DefaultView);
  return <ModelsBinding view={View} />;
}
