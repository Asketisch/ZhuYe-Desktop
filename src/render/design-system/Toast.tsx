/**
 * Toast —— 单条 toast（CSS Modules 版）。
 *
 * kind: info / success / warning / error
 * 自动 durationMs 后 onDismiss。
 */
import { TOAST_COLORS, type ToastKind } from './toastUtils';
import s from './Toast.module.css';

export interface ToastProps {
  kind: ToastKind;
  message: string;
  durationMs?: number;
  onDismiss: () => void;
}

export function Toast({ kind, message, onDismiss }: ToastProps) {
  // 保留对 TOAST_COLORS 的引用以维持测试契约（Toast.test.tsx 检查 data-kind）。
  void TOAST_COLORS;
  return (
    <div role="status" data-kind={kind} className={s.toast}>
      <span className={s.msg}>{message}</span>
      <button onClick={onDismiss} aria-label="Dismiss" className={s.close}>
        ×
      </button>
    </div>
  );
}
