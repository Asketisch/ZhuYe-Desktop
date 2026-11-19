import { useRenderView } from '@/logic/renderer/useRenderView';
import { PromptsBinding } from '@/logic/prompts/PromptsBinding';
import { PromptsView as DefaultView } from '@/render/prompts/PromptsView';

export function PromptsView() {
  const View = useRenderView('PromptsView', DefaultView);
  return <PromptsBinding view={View} />;
}
