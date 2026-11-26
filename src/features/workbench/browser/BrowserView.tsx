import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { BrowserBinding } from '@/logic/workbench/browser/BrowserBinding';
import { BrowserPanel as DefaultView } from '@/render/workbench/browser/BrowserPanel';

/** 浏览器面板切片(渲染/逻辑分离,同 preview 等切片三段式)。 */
export function BrowserView() {
  const View = useRenderView('BrowserPanel', DefaultView);
  return <BrowserBinding view={View} />;
}
