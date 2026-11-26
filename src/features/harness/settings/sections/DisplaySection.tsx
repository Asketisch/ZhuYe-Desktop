import { useRenderView } from '@/logic/renderer/useRenderView';
import { DisplayBinding } from '@/logic/settings/DisplayBinding';
import { DisplaySection as DefaultView } from '@/render/harness/settings/DisplaySection';
export function DisplaySection() { const View = useRenderView('DisplaySection', DefaultView); return <DisplayBinding view={View} />; }
