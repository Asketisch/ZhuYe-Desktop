/**
 * SegmentedControl —— 分段选择控件。
 *
 * 用于在少量互斥选项间切换（如 reasoning effort: low/medium/high）。
 */
import type { ReactNode } from 'react';
import s from './SegmentedControl.module.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** 可选描述（tooltip / 副标题）。 */
  hint?: string;
  /**
   * 选项的无障碍名称。label 为纯图标时**必填** —— 图标没有可计算的
   * accessible name,屏幕阅读器只会读到「未标记按钮」(axe 的
   * button-name 违规)。
   */
  ariaLabel?: string;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
  /** 每个选项的额外说明，渲染在 label 下方（适合少量选项的卡片式分段）。 */
  stacked?: boolean;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  disabled = false,
  stacked = false,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={[s.wrap, className].filter(Boolean).join(' ')}
      data-size={size}
      data-stacked={stacked || undefined}
      role="radiogroup"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.ariaLabel}
            title={opt.hint}
            disabled={disabled}
            data-active={active || undefined}
            className={s.opt}
            onClick={() => onChange(opt.value)}
          >
            <span className={s.label}>{opt.label}</span>
            {stacked && opt.hint && <span className={s.hint}>{opt.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
