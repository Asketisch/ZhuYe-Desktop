import { useRenderer } from '@/logic/renderer/RendererProvider';
import { TerminalBinding } from '@/logic/terminal/TerminalBinding';
import { TerminalView as TerminalPresentation } from '@/render/terminal/TerminalView';

export function TerminalView() {
  const renderer = useRenderer();
  return <TerminalBinding view={renderer?.TerminalView ?? TerminalPresentation} />;
}
