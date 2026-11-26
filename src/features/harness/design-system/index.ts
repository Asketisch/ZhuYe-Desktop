/**
 * design-system 切片公共 API 桶。
 */

// ===== Views =====
export { DesignSystemView } from './DesignSystemView';

// ===== Primitives =====
export { Button } from '@/render/harness/design-system/Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from '@/render/harness/design-system/Button';

export { IconButton } from '@/render/harness/design-system/IconButton';
export type { IconButtonProps } from '@/render/harness/design-system/IconButton';

export { Icon } from '@/render/harness/design-system/Icon';
export type { IconProps } from '@/render/harness/design-system/Icon';

export { Input } from './primitives/Input';
export type { InputProps } from './primitives/Input';

export { Textarea } from '@/render/harness/design-system/Textarea';
export type { TextareaProps } from '@/render/harness/design-system/Textarea';

export { Select } from '@/render/harness/design-system/Select';
export type { SelectProps } from '@/render/harness/design-system/Select';

export { SegmentedControl } from '@/render/harness/design-system/SegmentedControl';
export type { SegmentedControlProps, SegmentedOption } from '@/render/harness/design-system/SegmentedControl';

export { Badge } from '@/render/harness/design-system/Badge';
export type { BadgeProps, BadgeVariant } from '@/render/harness/design-system/Badge';

export { Card } from '@/render/harness/design-system/Card';
export type { CardProps } from '@/render/harness/design-system/Card';

export { EmptyState } from '@/render/harness/design-system/EmptyState';
export type { EmptyStateProps } from '@/render/harness/design-system/EmptyState';

export { Spinner } from '@/render/harness/design-system/Spinner';
export type { SpinnerProps } from '@/render/harness/design-system/Spinner';

export { Tooltip } from '@/render/harness/design-system/Tooltip';
export type { TooltipProps } from '@/render/harness/design-system/Tooltip';

export { Toast } from './primitives/Toast';
export type { ToastProps } from './primitives/Toast';
export type { ToastKind } from '@/logic/design-system/utils/toast';

export { ContextRing } from '@/render/harness/design-system/ContextRing';
export type { ContextRingProps } from '@/render/harness/design-system/ContextRing';
export type { RingSegment } from '@/render/harness/design-system/ring';

export { KeyHint } from '@/render/harness/design-system/KeyHint';
export type { KeyHintProps } from '@/render/harness/design-system/KeyHint';

// ===== Utils (保留 token 常量供外部用) =====
export { shortcutLabel, platformLabel, detectPlatform } from '@/logic/design-system/utils/keyHints';
export type { Platform } from '@/logic/design-system/utils/keyHints';

export { ringGeometry, segmentArc } from '@/render/harness/design-system/ring';
export type { RingGeometry } from '@/render/harness/design-system/ring';

export { TOAST_COLORS, DEFAULT_TOAST_MS } from '@/logic/design-system/utils/toast';
