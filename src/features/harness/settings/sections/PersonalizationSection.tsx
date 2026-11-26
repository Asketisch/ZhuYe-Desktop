import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { PersonalizationBinding } from '@/logic/harness/settings/PersonalizationBinding';
import { PersonalizationSection as DefaultView } from '@/render/harness/settings/PersonalizationSection';

export function PersonalizationSection() {
  const View = useRenderView('PersonalizationSection', DefaultView);
  return <PersonalizationBinding view={View} />;
}
