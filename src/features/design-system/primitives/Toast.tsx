import { useToastAutoDismiss } from '@/logic/webview/toastAutoDismiss';
import type { ToastProps } from '@/render/design-system/Toast';
import { Toast as DefaultView } from '@/render/design-system/Toast';

export type { ToastProps };

export function Toast(props: ToastProps) {
  useToastAutoDismiss(props.onDismiss, props.durationMs);
  return <DefaultView {...props} />;
}
