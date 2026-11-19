/**
 * Spinner —— 加载指示器。
 *
 * 默认 16px，跟随 currentColor。
 */
import type { CSSProperties } from 'react';
import s from './Spinner.module.css';

export interface SpinnerProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
  label?: string;
}

export function Spinner({ size = 16, className, style, label = 'Loading' }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={[s.spinner, className].filter(Boolean).join(' ')}
      style={{ width: size, height: size, ...style }}
    />
  );
}
