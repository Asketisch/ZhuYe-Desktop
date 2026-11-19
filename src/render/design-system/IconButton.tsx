/**
 * IconButton —— 方形图标按钮（工具栏高频用）。
 *
 * 只放图标，无文字。size 控制容器尺寸，图标默认比容器小一级。
 * variant 复用 Button 体系：default(ghost) / active / primary。
 */
import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import s from './IconButton.module.css';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: 'default' | 'active' | 'primary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  label: string; // 必填，作为 aria-label + tooltip title
  children: ReactNode;
  type?: 'button' | 'submit' | 'reset';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = 'default', size = 'md', label, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      title={label}
      aria-label={label}
      data-variant={variant}
      data-size={size}
      className={[s.btn, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
});
