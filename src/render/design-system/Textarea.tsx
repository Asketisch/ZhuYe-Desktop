/**
 * Textarea —— 多行文本输入。
 */
import { forwardRef } from 'react';
import type { TextareaHTMLAttributes } from 'react';
import s from './Input.module.css'; // 复用 Input 样式 token

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  size?: 'sm' | 'md';
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { size = 'md', invalid, className, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      data-size={size}
      data-invalid={invalid || undefined}
      aria-invalid={invalid || undefined}
      className={[s.bare, invalid && s.invalid, className].filter(Boolean).join(' ')}
      {...rest}
    />
  );
});
