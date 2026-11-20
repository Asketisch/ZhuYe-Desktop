import { useRenderView } from '@/logic/renderer/useRenderView';
import { PersonalizationBinding } from '@/logic/settings/PersonalizationBinding';
import { PersonalizationSection as DefaultView } from '@/render/settings/PersonalizationSection';

export function PersonalizationSection() {
  const View = useRenderView('PersonalizationSection', DefaultView);
  return <PersonalizationBinding view={View} />;
}
