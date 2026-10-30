/**
 * ModalShell —— 全屏遮罩 + 居中卡片（CSS Modules 版 + 焦点陷阱）。
 *
 * 阶段 A5 修复：
 *   - aria-modal="true" + role="dialog"。
 *   - 焦点陷阱：Tab/Shift+Tab 在 dialog 内循环；打开时聚焦 primary；关闭时还原焦点。
 *   - Enter 仅在 dialog 本身（非表单控件）聚焦时触发 primary，避免误提交。
 *   - Esc 关闭。
 *   - 点击遮罩关闭。
 *
 * 审查修复：
 *   - 副作用只依赖 `open`：onClose / primaryAction 走 latest-ref，
 *     调用方传内联函数不会让焦点副作用每次渲染重跑（曾把正在输入的
 *     textarea 焦点抢回 primary 按钮）。
 *   - 模块级弹窗栈：堆叠多个 modal 时只有栈顶响应 Escape/Enter/Tab，
 *     避免一次 Esc 把全部待审批同时否决。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Icon, IconButton } from '@/features/design-system';
import s from './ModalShell.module.css';

interface Props {
  title: string;
  open: boolean;
  onClose: () => void | Promise<void>;
  externalBusy?: boolean;
  onBusyChange?: (busy: boolean) => void;
  primaryAction?: { label: string; onClick: () => void | Promise<void>; autoFocus?: boolean; dataTestId?: string };
  secondaryAction?: { label: string; onClick: () => void | Promise<void>; dataTestId?: string };
  tertiaryAction?: { label: string; onClick: () => void | Promise<void> };
  children: ReactNode;
}

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** 模块级打开顺序栈：末位即栈顶 modal，只有它响应键盘。 */
const modalStack: number[] = [];
let modalSeq = 0;

export function ModalShell({
  title,
  open,
  onClose,
  externalBusy = false,
  onBusyChange,
  primaryAction,
  secondaryAction,
  tertiaryAction,
  children,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const externalBusyRef = useRef(externalBusy);
  externalBusyRef.current = externalBusy;
  const execute = (action: () => void | Promise<void>) => {
    if (busyRef.current || externalBusyRef.current) return;
    busyRef.current = true;
    onBusyChange?.(true);
    setBusy(true);
    setActionError(null);
    try {
      void Promise.resolve(action()).catch((error: unknown) => {
        setActionError(error instanceof Error ? error.message : String(error));
      }).finally(() => {
        busyRef.current = false;
        onBusyChange?.(false);
        setBusy(false);
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
      busyRef.current = false;
      onBusyChange?.(false);
      setBusy(false);
    }
  };
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // latest-ref：键盘/焦点副作用只挂一次（依赖 [open]），回调始终读最新值。
  const onCloseRef = useRef(onClose);
  const primaryActionRef = useRef(primaryAction);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    primaryActionRef.current = primaryAction;
  }, [primaryAction]);

  useEffect(() => {
    if (!open) return;
    const myToken = ++modalSeq;
    modalStack.push(myToken);
    const isTop = () => modalStack[modalStack.length - 1] === myToken;

    // 记录当前焦点，关闭时还原。
    restoreFocusRef.current = (document.activeElement as HTMLElement) ?? null;

    const dialog = dialogRef.current;
    // 初始聚焦 primary 按钮（或 dialog 本身）。
    const target = primaryRef.current ?? dialog;
    target?.focus();

    const getFocusable = (): HTMLElement[] => {
      if (!dialog) return [];
      return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
    };

    const onKey = (e: KeyboardEvent) => {
      // 非栈顶的 modal 不响应键盘（命令面板/其他 overlay 打开时同样让位）。
      if (!isTop()) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        execute(onCloseRef.current);
        return;
      }
      if (e.key === 'Tab') {
        // 焦点陷阱：在 dialog 内循环。
        const focusable = getFocusable();
        if (focusable.length === 0) {
          e.preventDefault();
          dialog?.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement;
        if (e.shiftKey) {
          if (active === first || !dialog?.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last || !dialog?.contains(active)) {
            e.preventDefault();
            first.focus();
          }
        }
        return;
      }
      const primary = primaryActionRef.current;
      if (e.key === 'Enter' && primary) {
        const active = document.activeElement as HTMLElement | null;
        const tag = active?.tagName;
        // 仅当焦点在 dialog 容器本身（dialog 自身或非表单控件子元素）时
        // 触发 primary。焦点跑出 dialog 时不接管,避免跨组件误提交。
        const insideDialog = !!active && !!dialog && dialog.contains(active);
        if (
          insideDialog &&
          (active === dialog ||
            (tag !== 'TEXTAREA' && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'BUTTON'))
        ) {
          e.preventDefault();
          execute(primary.onClick);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const idx = modalStack.indexOf(myToken);
      if (idx >= 0) modalStack.splice(idx, 1);
      // 还原焦点。
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className={s.overlay} onClick={(e) => { if (e.target === e.currentTarget) execute(onClose); }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={s.dialog}
      >
        <header className={s.header}>
          <h2 className={s.title}>{title}</h2>
          <IconButton label="Close" size="sm" disabled={busy || externalBusy} onClick={() => execute(onClose)}>
            <Icon icon={X} size={14} />
          </IconButton>
        </header>
        <div className={s.body}>{children}{actionError && <p role="alert" className={s.error}>{actionError}</p>}</div>
        {(tertiaryAction || secondaryAction || primaryAction) && (
          <footer className={s.footer}>
            {tertiaryAction && (
              <button className={s.btnGhost} disabled={busy || externalBusy} onClick={() => execute(tertiaryAction.onClick)}>
                {tertiaryAction.label}
              </button>
            )}
            <div className={s.footerRight}>
            {secondaryAction && (
              <button
                className={s.btnSecondary}
                disabled={busy || externalBusy}
                onClick={() => execute(secondaryAction.onClick)}
                data-testid={secondaryAction.dataTestId}
              >
                {secondaryAction.label}
              </button>
            )}
            {primaryAction && (
              <button
                ref={primaryRef}
                className={s.btnPrimary}
                disabled={busy || externalBusy}
                onClick={() => execute(primaryAction.onClick)}
                autoFocus={primaryAction.autoFocus}
                data-testid={primaryAction.dataTestId}
              >
                {primaryAction.label}
              </button>
            )}
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
