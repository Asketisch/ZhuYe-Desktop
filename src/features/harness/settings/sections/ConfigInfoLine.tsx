import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { ConfigInfoLineBinding } from '@/logic/harness/settings/ConfigInfoLineBinding';
import { ConfigInfoLine as DefaultView } from '@/render/harness/settings/ConfigInfoLine';
export function ConfigInfoLine() { const View = useRenderView('ConfigInfoLine', DefaultView); return <ConfigInfoLineBinding view={View} />; }
