/**
 * PageShell —— 非 Chat 视图统一外壳。
 *
 * 提供标题区（图标 + 标题 + 副标题 + 右侧操作）+ 滚动内容容器。
 * 所有非 Chat 视图套用此 shell，保证视觉一致。
 */
import type { ReactNode } from 'react';
import type { ComponentType } from 'react';
import s from './PageShell.module.css';

export interface PageShellProps {
  icon?: ComponentType;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** 内容区最大宽度档位。 */
  width?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

export function PageShell({ icon: IconComp, title, subtitle, actions, width = 'md', children }: PageShellProps) {
  return (
    <div className={s.root} data-width={width}>
      <header className={s.header}>
        <div className={s.headerLeft}>
          {IconComp && (
            <div className={s.icon}>
              <IconComp />
            </div>
          )}
          <div className={s.titleBlock}>
            <h1 className={s.title}>{title}</h1>
            {subtitle && <p className={s.subtitle}>{subtitle}</p>}
          </div>
        </div>
        {actions && <div className={s.actions}>{actions}</div>}
      </header>
      <div className={s.content}>{children}</div>
    </div>
  );
}
