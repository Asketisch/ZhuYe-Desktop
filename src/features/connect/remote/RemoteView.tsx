import { useRenderView } from '@/logic/renderer/useRenderView';
import { RemoteBinding } from '@/logic/remote/RemoteBinding';
import { RemoteView as DefaultView } from '@/render/connect/remote/RemoteView';

export function RemoteView() {
  const View = useRenderView('RemoteView', DefaultView);
  return <RemoteBinding view={View} />;
}
