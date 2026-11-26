import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { UpdatesBinding } from '@/logic/harness/settings/UpdatesBinding';
import { UpdatesSection as DefaultView } from '@/render/harness/settings/UpdatesSection';
export function UpdatesSection() { const View = useRenderView('UpdatesSection', DefaultView); return <UpdatesBinding view={View} />; }
