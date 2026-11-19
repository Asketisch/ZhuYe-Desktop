import { useRenderView } from '@/logic/renderer/useRenderView';
import { ImportBinding } from '@/logic/import/ImportBinding';
import { ImportView as DefaultView } from '@/render/import/ImportView';

export function ImportView() {
  const View = useRenderView('ImportView', DefaultView);
  return <ImportBinding view={View} />;
}
