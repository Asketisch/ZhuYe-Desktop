import { createContext, useContext } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { Renderer } from '@/contracts/renderer';
import type { RenderSlots } from '@/contracts/renderLayer';

const RendererContext = createContext<Renderer | null>(null);
const SlotContext = createContext<RenderSlots>({});

/** 向业务绑定提供由应用装配的渲染实现和子组件表。 */
export function RendererProvider({ renderer, slots = {}, children }: {
  renderer: Renderer;
  slots?: RenderSlots;
  children: ReactNode;
}) {
  return (
    <RendererContext.Provider value={renderer}>
      <SlotContext.Provider value={slots}>{children}</SlotContext.Provider>
    </RendererContext.Provider>
  );
}

/** 独立挂载旧功能视图时可由装配方提供兼容实现。 */
export function useRenderer(): Renderer | null {
  return useContext(RendererContext);
}

/** 按名称取得替换界面注册的子组件。 */
export function useRenderSlot<Props extends object>(name: string, fallback: ComponentType<Props>): ComponentType<Props> {
  const slots = useContext(SlotContext);
  return (slots[name] as ComponentType<Props> | undefined) ?? fallback;
}
