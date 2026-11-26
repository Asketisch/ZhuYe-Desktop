import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { PromptsBinding } from '@/logic/knowledge/prompts/PromptsBinding';
import { PromptsView as DefaultView } from '@/render/knowledge/prompts/PromptsView';

export function PromptsView() {
  const View = useRenderView('PromptsView', DefaultView);
  return <PromptsBinding view={View} />;
}
