import type { ShellViewProps } from '@/contracts/shell';
import s from './AppShell.module.css';

export function AppShell({ titleBar, sidebar, palette, sidebarOpen, inspectorOpen, sidebarLabel,
  inspectorLabel, suppressInteraction, toasts, onDismissToast, onOpenUpdates, content, slots }: ShellViewProps) {
  const { TitleBar, Sidebar, CommandPalette, ModalStack, Toast, ZRail, Inspector, StatusBar,
    ConfirmDialogHost, ViewErrorBoundary } = slots;
  return (
    <div className={s.shell}>
      <TitleBar {...titleBar} />
      <div className={s.body}>
        <ZRail onOpenUpdates={onOpenUpdates} />
        {sidebarOpen && <aside className={`${s.sidebar} ${s.sideHide}`.trim()} aria-label={sidebarLabel} data-testid="shell-sidebar">
          <Sidebar {...sidebar} />
        </aside>}
        <main className={s.main}><div className={s.content}><ViewErrorBoundary>{content}</ViewErrorBoundary></div></main>
        {inspectorOpen && <aside className={`${s.inspector} ${s.rightHide}`.trim()} aria-label={inspectorLabel} data-testid="shell-inspector"><Inspector /></aside>}
      </div>
      <StatusBar />
      {toasts.length > 0 && <div className={s.toastHost}>{toasts.map((toast) => <Toast key={toast.id}
        kind={toast.kind === 'warn' ? 'warning' : toast.kind} message={toast.message} durationMs={toast.ttlMs}
        onDismiss={() => onDismissToast(toast.id)} />)}</div>}
      <ModalStack suppressInteractionModals={suppressInteraction} />
      <ConfirmDialogHost />
      <CommandPalette {...palette} />
    </div>
  );
}
