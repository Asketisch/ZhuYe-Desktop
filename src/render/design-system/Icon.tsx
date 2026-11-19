/**
 * Icon —— lucide-react 统一封装。
 *
 * 用法：
 *   import { Icon } from '@/features/design-system';
 *   import { MessageSquare } from 'lucide-react';
 *   <Icon icon={MessageSquare} size={16} />
 *
 * 设计：
 *   - 统一 stroke-width=1.5（IDE 风更精细）
 *   - 默认 size 16，跟随 currentColor
 *   - 透传 className / style / aria 属性
 */
import type { ComponentType, CSSProperties } from 'react';
import type { LucideProps } from 'lucide-react';

export interface IconProps extends Omit<LucideProps, 'ref'> {
  icon: ComponentType<LucideProps>;
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** 无障碍标签；不传则对屏幕阅读器隐藏（装饰性图标）。 */
  label?: string;
}

export function Icon({ icon: LucideIcon, size = 16, label, className, style, ...rest }: IconProps) {
  return (
    <LucideIcon
      width={size}
      height={size}
      strokeWidth={1.75}
      className={className}
      style={style}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : 'presentation'}
      {...rest}
    />
  );
}
