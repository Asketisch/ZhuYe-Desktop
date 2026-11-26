/**
 * Tooltip —— 纯 CSS tooltip（hover 显示）。
 *
 * 用法：
 *   <Tooltip label="Settings">
 *     <IconButton ...><GearIcon/></IconButton>
 *   </Tooltip>
 *
 * 位置默认 top，可通过 side 切换。延迟由 CSS transition 控制。
 */
import type { ReactNode } from 'react';
import s from './Tooltip.module.css';

export interface TooltipProps {
  label: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /**
   * 允许多行 label。默认 `nowrap`(单行,适合短标签);
   * 设为 true 时切到 `pre-line`,把 `\n` 渲染成换行、折叠其余空白。
   * label 用数组 `.join('\n')` 拼接时需要它。
   */
  multiline?: boolean;
  children: ReactNode;
}

export function Tooltip({ label, side = 'top', multiline = false, children }: TooltipProps) {
  return (
    <span className={s.wrap} data-side={side}>
      {children}
      <span className={s.tip} role="tooltip" data-multiline={multiline || undefined}>
        {label}
      </span>
    </span>
  );
}
