import { useRenderView } from '@/logic/renderer/useRenderView';
import { ConfigInfoLineBinding } from '@/logic/settings/ConfigInfoLineBinding';
import { ConfigInfoLine as DefaultView } from '@/render/settings/ConfigInfoLine';
export function ConfigInfoLine() { const View = useRenderView('ConfigInfoLine', DefaultView); return <ConfigInfoLineBinding view={View} />; }
