import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { StatusBarBinding } from '@/logic/harness/shell/StatusBarBinding';
import { StatusBar as DefaultView } from '@/render/harness/shell/StatusBar';

export function StatusBar() {
  const View = useRenderView('StatusBar', DefaultView);
  return <StatusBarBinding view={View} />;
}
