import { useRenderView } from '@/logic/renderer/useRenderView';
import { TitleBarBinding } from '@/logic/shell/TitleBarBinding';
import { TitleBar as DefaultView } from '@/render/shell/TitleBar';

export function TitleBar(props: { sidebarOpen: boolean; onToggleSidebar: () => void; inspectorOpen: boolean; onToggleInspector: () => void }) {
  const View = useRenderView('TitleBar', DefaultView);
  return <TitleBarBinding view={View} {...props} />;
}
