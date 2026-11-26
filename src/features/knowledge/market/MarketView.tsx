/**
 * 市场页 —— 薄装配入口(TerminalView 同款模式)。
 *
 * 视图经 RendererProvider 可替换;无替换实现时回退默认展示组件,
 * 状态编排全部在 `src/logic/market/` 的 binding + controller。
 */
import { useRenderer } from '@/logic/harness/renderer/RendererProvider';
import { MarketBinding } from '@/logic/knowledge/market/MarketBinding';
import { MarketView as MarketPresentation } from '@/render/knowledge/market/MarketView';

export function MarketView() {
  const renderer = useRenderer();
  return <MarketBinding view={renderer?.MarketView ?? MarketPresentation} />;
}
