import { useRenderer } from '@/logic/harness/renderer/RendererProvider';
import { AboutBinding } from '@/logic/pages/about/AboutBinding';
import { AboutView as DefaultView } from '@/render/pages/about/AboutView';

export function AboutView() {
  const renderer = useRenderer();
  return <AboutBinding view={renderer?.AboutView ?? DefaultView} />;
}
