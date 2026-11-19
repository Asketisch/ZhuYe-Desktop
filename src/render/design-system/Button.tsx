/**
 * Button —— 全局 button primitive（CSS Modules 版）。
 *
 * 变体：primary / secondary / tertiary / danger / ghost
 * 尺寸：sm / md / lg
 * 支持 loading 态（左侧 spinner，自动 disabled）。
 *
 * 用 CSS class + data-attribute 驱动样式，避免 inline style 重算。
 */
import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import s from './Button.module.css';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  loading?: boolean;
  /** loading 时显示在左侧的图标，默认是 Spinner。 */
  leftIcon?: ReactNode;
  type?: 'button' | 'submit' | 'reset';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    block = false,
    loading = false,
    leftIcon,
    type = 'button',
    className,
    disabled,
    children,
    ...rest
  },
  ref,
) {
  const cls = [
    s.btn,
    block && s.block,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      type={type}
      data-variant={variant}
      data-size={size}
      data-block={block || undefined}
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner className={s.spinner} /> : leftIcon}
      {children}
    </button>
  );
});
