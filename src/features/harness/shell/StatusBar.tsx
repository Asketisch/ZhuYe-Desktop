import { useRenderView } from '@/logic/renderer/useRenderView';
import { StatusBarBinding } from '@/logic/shell/StatusBarBinding';
import { StatusBar as DefaultView } from '@/render/shell/StatusBar';

export function StatusBar() {
  const View = useRenderView('StatusBar', DefaultView);
  return <StatusBarBinding view={View} />;
}
