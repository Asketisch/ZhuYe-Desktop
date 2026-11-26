import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { DisplayBinding } from '@/logic/harness/settings/DisplayBinding';
import { DisplaySection as DefaultView } from '@/render/harness/settings/DisplaySection';
export function DisplaySection() { const View = useRenderView('DisplaySection', DefaultView); return <DisplayBinding view={View} />; }
