/**
 * 泳道页 —— 薄装配入口(TerminalView 同款模式)。
 *
 * 视图经 RendererProvider 可替换;无替换实现时回退默认展示组件,
 * 状态编排全部在 `src/logic/lanes/` 的 binding + controller。
 */
import { useRenderer } from '@/logic/renderer/RendererProvider';
import { LanesBinding } from '@/logic/lanes/LanesBinding';
import { LanesView as LanesPresentation } from '@/render/orchestration/lanes/LanesView';

export function LanesView() {
  const renderer = useRenderer();
  return <LanesBinding view={renderer?.LanesView ?? LanesPresentation} />;
}
