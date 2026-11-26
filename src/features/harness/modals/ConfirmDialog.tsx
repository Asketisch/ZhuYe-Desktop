/**
 * ConfirmDialog —— 应用内确认对话框（promise 式，替代 window.confirm）。
 *
 * 为什么不用 window.confirm：Tauri 桌面端的 WKWebView（wry）不实现
 * `WKUIDelegate` 的 JS 对话框回调，`window.confirm()` 在 macOS（以及
 * 未弹原生框的环境）不显示任何对话框且恒返回 false —— 此前所有依赖
 * 它的删除/归档确认都会静默失败（点击后无任何反应）。
 *
 * 用法：
 *   const ok = await confirmDialog({
 *     title: t('threads.delete'),
 *     message: t('threads.deleteSelectedConfirm', { n: '3' }),
 *     confirmLabel: t('common.delete'),
 *   });
 *   if (!ok) return;
 *
 * 需要在应用根部挂载一次 <ConfirmDialogHost />（AppShell，与 ModalStack 并列）。
 * 确认 → resolve(true)；取消 / Esc / 点遮罩 → resolve(false)。
 * 并发调用时前一个请求以 false 结束（仅保留最后一个）。
 */
import { useSyncExternalStore } from 'react';
import { useI18n } from '@/utils/i18n';
import { ModalShell } from './ModalShell';

export { confirmDialog } from '@/logic/harness/modals/confirm';
export type { ConfirmOptions } from '@/logic/harness/modals/confirm';
import { subscribeConfirm, getConfirmRequest, settleConfirm } from '@/logic/harness/modals/confirm';

/** 应用根部的宿主组件：有确认请求时渲染 ModalShell。 */
export function ConfirmDialogHost() {
  const request = useSyncExternalStore(
    subscribeConfirm,
    getConfirmRequest,
    getConfirmRequest,
  );
  const { t } = useI18n();
  if (!request) return null;
  return (
    <ModalShell
      title={request.title}
      open={true}
      onClose={() => settleConfirm(false)}
      secondaryAction={{
        label: request.cancelLabel ?? t('common.cancel'),
        onClick: () => settleConfirm(false),
        dataTestId: 'confirm-dialog-cancel',
      }}
      primaryAction={{
        label: request.confirmLabel ?? t('common.confirm'),
        onClick: () => settleConfirm(true),
        autoFocus: true,
        dataTestId: 'confirm-dialog-confirm',
      }}
    >
      <p>{request.message}</p>
    </ModalShell>
  );
}
