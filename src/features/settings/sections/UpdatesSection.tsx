import { useRenderView } from '@/logic/renderer/useRenderView';
import { UpdatesBinding } from '@/logic/settings/UpdatesBinding';
import { UpdatesSection as DefaultView } from '@/render/settings/UpdatesSection';
export function UpdatesSection() { const View = useRenderView('UpdatesSection', DefaultView); return <UpdatesBinding view={View} />; }
