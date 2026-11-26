/**
 * Input —— text input 原子。
 *
 * 消费 token，带 focus 态 + 左侧图标槽（如搜索）。
 */
import { forwardRef } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import s from '@/render/harness/design-system/Input.module.css';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md';
  leading?: ReactNode; // 前置图标
  trailing?: ReactNode; // 后置内容
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = 'md', leading, trailing, invalid, className, ...rest },
  ref,
) {
  if (leading || trailing) {
    return (
      <div className={[s.wrap, invalid && s.invalid, className].filter(Boolean).join(' ')} data-size={size}>
        {leading && <span className={s.leading}>{leading}</span>}
        <input
          ref={ref}
          className={s.input}
          data-has-leading={leading ? '' : undefined}
          aria-invalid={invalid || undefined}
          {...rest}
        />
        {trailing && <span className={s.trailing}>{trailing}</span>}
      </div>
    );
  }
  return (
    <input
      ref={ref}
      data-size={size}
      data-invalid={invalid || undefined}
      aria-invalid={invalid || undefined}
      className={[s.bare, invalid && s.invalid, className].filter(Boolean).join(' ')}
      {...rest}
    />
  );
});
