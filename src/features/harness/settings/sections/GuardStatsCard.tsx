import { useRenderView } from '@/logic/renderer/useRenderView';
import { GuardStatsBinding } from '@/logic/settings/GuardStatsBinding';
import { GuardStatsCard as DefaultView } from '@/render/harness/settings/GuardStatsCard';
export function GuardStatsCard() { const View = useRenderView('GuardStatsCard', DefaultView); return <GuardStatsBinding view={View} />; }
