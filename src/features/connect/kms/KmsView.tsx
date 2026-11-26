import { useRenderView } from '@/logic/renderer/useRenderView';
import { KmsBinding } from '@/logic/kms/KmsBinding';
import { KmsView as DefaultView } from '@/render/connect/kms/KmsView';

export function KmsView() {
  const View = useRenderView('KmsView', DefaultView);
  return <KmsBinding view={View} />;
}
