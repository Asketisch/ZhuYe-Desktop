/**
 * UsageView —— 薄装配入口。
 */
import { useRenderView } from '@/logic/renderer/useRenderView';
import { UsageBinding } from '@/logic/usage/UsageBinding';
import { UsageView as DefaultView } from '@/render/usage/UsageView';

export function UsageView() {
  const View = useRenderView('UsageView', DefaultView);
  return <UsageBinding view={View} />;
}
