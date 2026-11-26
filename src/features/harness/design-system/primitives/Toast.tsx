import { useToastAutoDismiss } from '@/logic/workbench/webview/toastAutoDismiss';
import type { ToastProps } from '@/render/harness/design-system/Toast';
import { Toast as DefaultView } from '@/render/harness/design-system/Toast';

export type { ToastProps };

export function Toast(props: ToastProps) {
  useToastAutoDismiss(props.onDismiss, props.durationMs);
  return <DefaultView {...props} />;
}
