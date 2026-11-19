/**
 * Card —— 通用内容卡片。
 *
 * level: flat(无边框) / outlined(默认描边) / elevated(阴影提升)
 */
import type { HTMLAttributes, ReactNode } from 'react';
import s from './Card.module.css';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  level?: 'flat' | 'outlined' | 'elevated';
  /** 内边距档位。 */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  children?: ReactNode;
}

export function Card({
  level = 'outlined',
  padding = 'md',
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      data-level={level}
      data-padding={padding}
      className={[s.card, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </div>
  );
}
