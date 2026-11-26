import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { GuardStatsBinding } from '@/logic/harness/settings/GuardStatsBinding';
import { GuardStatsCard as DefaultView } from '@/render/harness/settings/GuardStatsCard';
export function GuardStatsCard() { const View = useRenderView('GuardStatsCard', DefaultView); return <GuardStatsBinding view={View} />; }
