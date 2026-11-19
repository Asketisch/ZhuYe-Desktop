/**
 * Toast 工具 —— 计时 + 自动消失。
 */
export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastInput {
  kind: ToastKind;
  message: string;
  durationMs?: number; // default 4000
}

export const TOAST_COLORS: Record<ToastKind, { bg: string; fg: string; border: string }> = {
  info: { bg: '#dbeafe', fg: '#1e40af', border: '#93c5fd' },
  success: { bg: '#dcfce7', fg: '#166534', border: '#86efac' },
  warning: { bg: '#fef3c7', fg: '#92400e', border: '#fcd34d' },
  error: { bg: '#fee2e2', fg: '#991b1b', border: '#fca5a5' },
};

export const DEFAULT_TOAST_MS = 4000;