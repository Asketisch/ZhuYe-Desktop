/**
 * DockOverlays —— 右 dock 浮层容器（标签总览 / 标签右键菜单）。
 *
 * 锚点态在绑定层（render 层禁止 hook），本组件按 props 渲染浮层；
 * tabs 从 shellUi store 直接读取（浮层只读展示，无需层层透传）。
 */
import type { DockOverlaysProps } from '@/contracts/shell';
import { useShellUi } from '@/stores/shellUi';
import { DockTabOverview } from './DockTabOverview';
import { DockContextMenu } from './DockContextMenu';

export function DockOverlays({
  overviewAnchor, contextMenu, onToggleOverview, onOpenContextMenu,
  onActivateTab, onReopenClosedTab, onCloseTab, onCloseOthers, onCloseAll,
}: DockOverlaysProps) {
  const tabs = useShellUi((s) => s.dockTabs);
  const activeId = useShellUi((s) => s.dockActiveId);
  const recentlyClosedTabs = useShellUi((s) => s.recentlyClosedTabs);

  return (
    <>
      {overviewAnchor && (
        <DockTabOverview
          anchor={overviewAnchor}
          tabs={tabs}
          activeId={activeId}
          recentlyClosedTabs={recentlyClosedTabs}
          onDismiss={() => onToggleOverview(null)}
          onActivate={onActivateTab}
          onReopen={onReopenClosedTab}
        />
      )}
      {contextMenu && (
        <DockContextMenu
          anchor={contextMenu.anchor}
          tabCount={tabs.length}
          onDismiss={() => onOpenContextMenu(contextMenu.tabId, null)}
          onClose={() => onCloseTab(contextMenu.tabId)}
          onCloseOthers={() => onCloseOthers(contextMenu.tabId)}
          onCloseAll={onCloseAll}
        />
      )}
    </>
  );
}
