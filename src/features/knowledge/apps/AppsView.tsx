import { useI18n } from '@/utils/i18n';
import { useRenderer } from '@/logic/harness/renderer/RendererProvider';
import { AppsView as DefaultView } from '@/render/knowledge/apps/AppsView';

export function AppsView() {
  const { t } = useI18n();
  const View = useRenderer()?.AppsView ?? DefaultView;
  return <View t={t} />;
}
