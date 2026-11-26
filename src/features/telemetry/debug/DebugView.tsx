import { useRenderer } from '@/logic/harness/renderer/RendererProvider';
import { DebugBinding } from '@/logic/telemetry/debug/DebugBinding';
import { DebugView as DefaultView } from '@/render/telemetry/debug/DebugView';

export function DebugView() {
  const renderer = useRenderer();
  return <DebugBinding view={renderer?.DebugView ?? DefaultView} />;
}
