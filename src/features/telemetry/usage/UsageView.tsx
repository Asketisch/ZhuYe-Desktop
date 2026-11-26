/**
 * UsageView —— 薄装配入口。
 */
import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { UsageBinding } from '@/logic/telemetry/usage/UsageBinding';
import { UsageView as DefaultView } from '@/render/telemetry/usage/UsageView';

export function UsageView() {
  const View = useRenderView('UsageView', DefaultView);
  return <UsageBinding view={View} />;
}
