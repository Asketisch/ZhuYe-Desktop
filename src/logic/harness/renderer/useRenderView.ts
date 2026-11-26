import type { ComponentType } from 'react';
import { useRenderer } from './RendererProvider';

/** 按名称从应用装配的渲染入口选择视图，未注册时回退默认实现。 */
export function useRenderView<Props extends object>(
  name: string,
  fallback: ComponentType<Props>,
): ComponentType<Props> {
  const renderer = useRenderer();
  const candidate = renderer
    ? (renderer as unknown as Record<string, ComponentType<Props> | undefined>)[name]
    : undefined;
  return candidate ?? fallback;
}
