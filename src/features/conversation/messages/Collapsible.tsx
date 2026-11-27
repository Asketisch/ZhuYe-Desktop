/**
 * Collapsible —— 可折叠容器（thinking / tool_call / tool_output 复用）。
 *
 * 头部：左侧状态色条 + 图标 + 标题，右侧展开/收起箭头。
 * 默认非受控（内部 useState）；传 `open` + `onToggle` 即转为受控
 * （ThinkingCollapsible 需要在外部挂自动收起等编排逻辑）。
 */
import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Icon } from '@/features/harness/design-system';
import s from '@/render/conversation/messages/Collapsible.module.css';

export interface CollapsibleProps {
  label: ReactNode;
  /** 左侧图标（通常是状态/类型图标）。 */
  icon?: ReactNode;
  /** 主题色（影响左侧色条 + 图标颜色）。 */
  accent?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  defaultOpen?: boolean;
  /** 受控展开态（传入即接管内部 open 状态）。 */
  open?: boolean;
  /** 受控切换回调（无论受控与否都回传目标态）。 */
  onToggle?: (next: boolean) => void;
  children: ReactNode;
}

export function Collapsible({ label, icon, accent = 'default', defaultOpen = false, open: openProp, onToggle, children }: CollapsibleProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : uncontrolled;
  const toggle = () => {
    const next = !open;
    if (!isControlled) setUncontrolled(next);
    onToggle?.(next);
  };
  return (
    <div className={s.wrap} data-accent={accent} data-open={open || undefined}>
      <button
        className={s.header}
        onClick={toggle}
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
