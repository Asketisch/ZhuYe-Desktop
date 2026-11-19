/**
 * Collapsible —— 可折叠容器（thinking / tool_call / tool_output 复用）。
 *
 * 头部：左侧状态色条 + 图标 + 标题，右侧展开/收起箭头。
 */
import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Icon } from '@/features/design-system';
import s from '@/render/messages/Collapsible.module.css';

export interface CollapsibleProps {
  label: ReactNode;
  /** 左侧图标（通常是状态/类型图标）。 */
  icon?: ReactNode;
  /** 主题色（影响左侧色条 + 图标颜色）。 */
  accent?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  defaultOpen?: boolean;
  children: ReactNode;
}

export function Collapsible({ label, icon, accent = 'default', defaultOpen = false, children }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={s.wrap} data-accent={accent} data-open={open || undefined}>
      <button
        className={s.header}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className={s.bar} aria-hidden="true" />
        {icon && <span className={s.icon}>{icon}</span>}
        <span className={s.label}>{label}</span>
        <span className={s.chevron}>
          <Icon icon={ChevronRight} size={12} />
        </span>
      </button>
      {open && <div className={s.body}>{children}</div>}
    </div>
  );
}
