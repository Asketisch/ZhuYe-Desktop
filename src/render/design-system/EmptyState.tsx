/**
 * EmptyState —— 统一空状态。
 *
 * 用于：无数据列表、stub 视图、错误兜底、首次使用引导。
 */
import type { ReactNode } from 'react';
import s from './EmptyState.module.css';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode; // 通常是一个 Button
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function EmptyState({ icon, title, description, action, size = 'md', className }: EmptyStateProps) {
  return (
    <div data-size={size} className={[s.empty, className].filter(Boolean).join(' ')}>
      {icon && <div className={s.icon}>{icon}</div>}
      <div className={s.title}>{title}</div>
      {description && <div className={s.desc}>{description}</div>}
      {action && <div className={s.action}>{action}</div>}
    </div>
  );
}
