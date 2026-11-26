import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { HomeBinding } from '@/logic/conversation/home/HomeBinding';
import { HomeView as DefaultView } from '@/render/conversation/home/HomeView';

export function HomeView() {
  const View = useRenderView('HomeView', DefaultView);
  return <HomeBinding view={View} />;
}
