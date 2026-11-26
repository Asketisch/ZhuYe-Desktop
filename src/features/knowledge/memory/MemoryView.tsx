import { useRenderView } from '@/logic/renderer/useRenderView';
import { MemoryBinding } from '@/logic/memory/MemoryBinding';
import { MemoryView as DefaultView } from '@/render/memory/MemoryView';

export function MemoryView() {
  const View = useRenderView('MemoryView', DefaultView);
  return <MemoryBinding view={View} />;
}
