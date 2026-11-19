/**
 * Badge —— 状态徽标。
 *
 * variant: neutral / accent / success / warning / danger / info
 * 替代散落的 <span style={{ color: '#xxx' }}> 徽标。
 */
import type { HTMLAttributes, ReactNode } from 'react';
import s from './Badge.module.css';

export type BadgeVariant = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  /** 实心填充（用于强突出，如计数）。 */
  solid?: boolean;
  /** 小圆点（用于在线状态指示）。 */
  dot?: boolean;
  children?: ReactNode;
}

export function Badge({
  variant = 'neutral',
  solid = false,
  dot = false,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      data-variant={variant}
      data-solid={solid || undefined}
      className={[s.badge, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {dot && <span className={s.dot} aria-hidden="true" />}
      {children}
    </span>
  );
}
