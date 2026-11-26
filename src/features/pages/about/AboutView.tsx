import { useRenderer } from '@/logic/renderer/RendererProvider';
import { AboutBinding } from '@/logic/about/AboutBinding';
import { AboutView as DefaultView } from '@/render/pages/about/AboutView';

export function AboutView() {
  const renderer = useRenderer();
  return <AboutBinding view={renderer?.AboutView ?? DefaultView} />;
}
