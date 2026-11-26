/**
 * design-system 切片公共 API 桶。
 */

// ===== Views =====
export { DesignSystemView } from './DesignSystemView';

// ===== Primitives =====
export { Button } from '@/render/design-system/Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from '@/render/design-system/Button';

export { IconButton } from '@/render/design-system/IconButton';
export type { IconButtonProps } from '@/render/design-system/IconButton';

export { Icon } from '@/render/design-system/Icon';
export type { IconProps } from '@/render/design-system/Icon';

export { Input } from './primitives/Input';
export type { InputProps } from './primitives/Input';

export { Textarea } from '@/render/design-system/Textarea';
export type { TextareaProps } from '@/render/design-system/Textarea';

export { Select } from '@/render/design-system/Select';
export type { SelectProps } from '@/render/design-system/Select';

export { SegmentedControl } from '@/render/design-system/SegmentedControl';
export type { SegmentedControlProps, SegmentedOption } from '@/render/design-system/SegmentedControl';

export { Badge } from '@/render/design-system/Badge';
export type { BadgeProps, BadgeVariant } from '@/render/design-system/Badge';

export { Card } from '@/render/design-system/Card';
export type { CardProps } from '@/render/design-system/Card';

export { EmptyState } from '@/render/design-system/EmptyState';
export type { EmptyStateProps } from '@/render/design-system/EmptyState';

export { Spinner } from '@/render/design-system/Spinner';
export type { SpinnerProps } from '@/render/design-system/Spinner';

export { Tooltip } from '@/render/design-system/Tooltip';
export type { TooltipProps } from '@/render/design-system/Tooltip';

export { Toast } from './primitives/Toast';
export type { ToastProps } from './primitives/Toast';
export type { ToastKind } from '@/logic/design-system/utils/toast';

export { ContextRing } from '@/render/design-system/ContextRing';
export type { ContextRingProps } from '@/render/design-system/ContextRing';
export type { RingSegment } from '@/logic/design-system/utils/ring';

export { KeyHint } from '@/render/design-system/KeyHint';
export type { KeyHintProps } from '@/render/design-system/KeyHint';

// ===== Utils (保留 token 常量供外部用) =====
export { shortcutLabel, platformLabel, detectPlatform } from '@/logic/design-system/utils/keyHints';
export type { Platform } from '@/logic/design-system/utils/keyHints';

export { ringGeometry, segmentArc } from '@/logic/design-system/utils/ring';
export type { RingGeometry } from '@/logic/design-system/utils/ring';

export { TOAST_COLORS, DEFAULT_TOAST_MS } from '@/logic/design-system/utils/toast';
