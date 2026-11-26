import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { SecurityScanBinding } from '@/logic/harness/settings/SecurityScanBinding';
import { SecurityScanCard as DefaultView } from '@/render/harness/settings/SecurityScanCard';
export function SecurityScanCard() { const View = useRenderView('SecurityScanCard', DefaultView); return <SecurityScanBinding view={View} />; }
