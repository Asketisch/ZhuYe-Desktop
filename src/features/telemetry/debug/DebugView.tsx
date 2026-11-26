import { useRenderer } from '@/logic/renderer/RendererProvider';
import { DebugBinding } from '@/logic/debug/DebugBinding';
import { DebugView as DefaultView } from '@/render/telemetry/debug/DebugView';

export function DebugView() {
  const renderer = useRenderer();
  return <DebugBinding view={renderer?.DebugView ?? DefaultView} />;
}
