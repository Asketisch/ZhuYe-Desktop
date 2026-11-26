/**
 * 右 dock 标签页右键菜单。
 *
 * 关闭标签 / 关闭其他标签（仅 1 个时禁用）/ 关闭所有标签。
 */
import { AnchoredPopover } from './AnchoredPopover';
import { useI18n } from '@/utils/i18n';

export interface DockContextMenuProps {
  anchor: HTMLElement | null;
  tabCount: number;
  onDismiss: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
}

export function DockContextMenu({
  anchor, tabCount, onDismiss, onClose, onCloseOthers, onCloseAll,
}: DockContextMenuProps) {
  const { t } = useI18n();
  if (!anchor) return null;
  return (
    <AnchoredPopover anchor={anchor} className="dock-context-menu" testId="dock-context-menu" onDismiss={onDismiss}>
      <button type="button" onClick={() => { onClose(); onDismiss(); }} data-testid="dock-menu-close">
        {t('harness.dock.closeTab')}
      </button>
      <button
        type="button"
        disabled={tabCount <= 1}
        onClick={() => { onCloseOthers(); onDismiss(); }}
        data-testid="dock-menu-closeOthers"
      >
        {t('harness.dock.closeOtherTabs')}
      </button>
      <button type="button" onClick={() => { onCloseAll(); onDismiss(); }} data-testid="dock-menu-closeAll">
        {t('harness.dock.closeAllTabs')}
      </button>
    </AnchoredPopover>
  );
}
