import { useRenderView } from '@/logic/renderer/useRenderView';
import { SecurityScanBinding } from '@/logic/settings/SecurityScanBinding';
import { SecurityScanCard as DefaultView } from '@/render/settings/SecurityScanCard';
export function SecurityScanCard() { const View = useRenderView('SecurityScanCard', DefaultView); return <SecurityScanBinding view={View} />; }
