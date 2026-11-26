import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { MemoryBinding } from '@/logic/knowledge/memory/MemoryBinding';
import { MemoryView as DefaultView } from '@/render/knowledge/memory/MemoryView';

export function MemoryView() {
  const View = useRenderView('MemoryView', DefaultView);
  return <MemoryBinding view={View} />;
}
