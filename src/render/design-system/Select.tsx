/**
 * Select —— 原生 select 封装（消费 token + 自定义箭头）。
 */
import { forwardRef } from 'react';
import type { SelectHTMLAttributes, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import s from './Input.module.css';

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: 'sm' | 'md';
  invalid?: boolean;
  children: ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size = 'md', invalid, className, children, ...rest },
  ref,
) {
  return (
    <div className={[s.wrap, invalid && s.invalid, className].filter(Boolean).join(' ')} data-size={size}>
      <select ref={ref} className={s.input} {...rest}>
        {children}
      </select>
      <span className={s.trailing}>
        <ChevronDown size={14} strokeWidth={2} />
      </span>
    </div>
  );
});
