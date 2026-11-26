import { useRenderView } from '@/logic/renderer/useRenderView';
import { HomeBinding } from '@/logic/home/HomeBinding';
import { HomeView as DefaultView } from '@/render/conversation/home/HomeView';

export function HomeView() {
  const View = useRenderView('HomeView', DefaultView);
  return <HomeBinding view={View} />;
}
