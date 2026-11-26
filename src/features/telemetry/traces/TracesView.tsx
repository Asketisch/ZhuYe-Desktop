/**
 * TracesView —— 薄装配入口。
 */
import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { TracesBinding } from '@/logic/telemetry/traces/TracesBinding';
import { TracesView as DefaultView } from '@/render/telemetry/traces/TracesView';
import { SpansPanel } from '@/render/telemetry/traces/SpansPanel';

export function TracesView() {
  const View = useRenderView('TracesView', DefaultView);
  const SpansView = useRenderView('SpansPanel', SpansPanel);
  return <TracesBinding view={View} spansView={SpansView} />;
}
