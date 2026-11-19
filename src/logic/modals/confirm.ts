export interface ConfirmOptions {
  title: string;
  message: string;
  /** 确认按钮文案（默认 common.confirm）。 */
  confirmLabel?: string;
  /** 取消按钮文案（默认 common.cancel）。 */
  cancelLabel?: string;
}

interface PendingRequest extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

let pending: PendingRequest | null = null;
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) listener();
}

export function subscribeConfirm(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function settleConfirm(ok: boolean) {
  pending?.resolve(ok);
  pending = null;
  emitChange();
}

/** 弹出确认框并等待用户选择。 */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  if (pending) pending.resolve(false);
  return new Promise<boolean>((resolve) => {
    pending = { ...opts, resolve };
    emitChange();
  });
}

/** 当前待处理的确认请求。 */
export function getConfirmRequest() { return pending; }
