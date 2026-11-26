/**
 * TracesView —— 薄装配入口。
 */
import { useRenderView } from '@/logic/renderer/useRenderView';
import { TracesBinding } from '@/logic/traces/TracesBinding';
import { TracesView as DefaultView } from '@/render/traces/TracesView';
import { SpansPanel } from '@/render/traces/SpansPanel';

export function TracesView() {
  const View = useRenderView('TracesView', DefaultView);
  const SpansView = useRenderView('SpansPanel', SpansPanel);
  return <TracesBinding view={View} spansView={SpansView} />;
}
