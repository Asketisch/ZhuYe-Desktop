/**
 * CornerWidget —— 右上角交互栈的单个折叠组件骨架。
 *
 * 形态：折叠态 = chip（图标 + 文案 + 徽标 + 箭头）；展开态 = chip 下方的
 * 面板。开关状态组件内闭环（各 widget 互不影响），由 `defaultOpen`
 * 决定首态。内容无关的 widget 由调用方决定不渲染。
 */
import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Icon } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import s from '@/render/shell/CornerWidgets.module.css';

export interface CornerWidgetProps {
  /** 测试锚点（`corner-<name>`）。 */
  testId: string;
  /** chip 图标。 */
  icon: ReactNode;
  /** chip 主文案。 */
  label: string;
  /** chip 徽标（如 todo 的 `3/7`）；无则不渲染。 */
  badge?: string;
  /** chip 是否高亮（如目标活跃/子代理运行中）。 */
  active?: boolean;
  /** 首态是否展开（缺省折叠）。 */
  defaultOpen?: boolean;
  /** 展开面板内容。 */
  children: ReactNode;
}

export function CornerWidget({ testId, icon, label, badge, active, defaultOpen = false, children }: CornerWidgetProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={s.widget} data-testid={`corner-${testId}`} data-open={open || undefined}>
      <button
        type="button"
        className={`${s.chip}${active ? ` ${s.chipActive}` : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid={`corner-${testId}-chip`}
      >
        <Icon icon={open ? ChevronDown : ChevronRight} size={11} className={s.caret} />
        <span className={s.chipIcon}>{icon}</span>
        <span className={s.chipLabel}>{label}</span>
        {badge && <span className={s.chipBadge}>{badge}</span>}
        <span className={s.chipHint}>{open ? t('harness.corner.collapse') : t('harness.corner.expand')}</span>
      </button>
      {open && (
        <div className={s.panel} data-testid={`corner-${testId}-panel`}>
          {children}
        </div>
      )}
    </div>
  );
}
