/**
 * harness 应用壳（v3 设计稿移植）—— 纯展示组件。
 *
 * 骨架：标题条 + 侧栏 + 主区（路由视图 + 底部终端面板）+ 右 dock（ZCode 式
 * 标签条 + 内容面板）+ 浮层（任务中心 / 命令面板 / 设置）。主区内容由
 * TanStack Router 的 <Outlet/> 注入；全部状态与监听由 ShellBinding 持有，
 * 浮层锚点态同样在绑定层，这里只把回调透传并把 DockOverlays slot 渲染出来。
 */
import { AlarmClock, Circle, Plus, Settings } from 'lucide-react';
import type { ShellViewProps } from '@/contracts/shell';
import { Icon } from '../design-system/Icon';
import { DockTabBar } from './DockTabBar';

export function AppShell({
  titleBar, sidebar, palette, inspectorOpen, sidebarLabel, inspectorLabel,
  suppressInteraction, toasts, onDismissToast, content, slots, harness,
}: ShellViewProps) {
  const { TitleBar, Sidebar, CommandPalette, ModalStack, Toast,
    ConfirmDialogHost, ViewErrorBoundary, DockPanel, DockResizer, TerminalDock,
    InboxPanel, SettingsHost, DockOverlays } = slots;
  const { data, dock } = harness;
  const { t } = data;

  const activeKind = dock.tabs.find((tab) => tab.id === dock.activeId)?.kind;
  const appCls = [
    'app',
    harness.rail ? 'rail' : '',
    inspectorOpen ? '' : 'no-inspector',
    harness.termOpen ? 'term-open' : '',
    dock.wide ? 'dock-wide' : '',
    dock.fullView ? 'dock-full' : '',
    activeKind === 'files' ? 'dock-files' : '',
    activeKind === 'agents' ? 'dock-agents' : '',
  ].filter(Boolean).join(' ');

  const navItem = (
    label: string,
    opts: { on?: boolean; kbd?: string; onClick: () => void; icon: React.ReactNode; testid: string },
  ) => (
    <button
      key={label}
      type="button"
      className={`nav${opts.on ? ' on' : ''}`}
      onClick={opts.onClick}
      data-testid={opts.testid}
    >
      {opts.icon}
      <span className="lbl">{label}</span>
      {opts.kbd && <span className="kbd mono">{opts.kbd}</span>}
    </button>
  );

  return (
    <div className={appCls} data-viewmode={data.viewMode} data-testid="harness-app">
      <TitleBar {...titleBar} />

      <div className="body">
        {/* ===== 侧栏 ===== */}
        <aside className="sidebar" aria-label={sidebarLabel} data-testid="harness-sidebar">
          <div className="brand">
            <span className="brand-mark" data-testid="harness-brand-mark">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="3" y="3" width="10" height="10" rx="2.5" fill="currentColor" />
              </svg>
            </span>
            <span className="brand-name">ZhuYe</span>
            <span className="brand-badge">{t('harness.brandBadge')}</span>
          </div>

          <nav className="sb-nav">
            {navItem(t('harness.nav.new'), {
              on: data.viewMode === 'home',
              onClick: () => { sidebar.onNewChat?.(); },
              icon: <Icon icon={Plus} size={15} />,
              testid: 'harness-nav-new',
            })}
            {navItem(t('harness.nav.automation'), {
              on: data.pathname === "/schedule",
              onClick: () => data.navigate('/schedule'),
              icon: <AlarmClock size={15} strokeWidth={1.5} aria-hidden />,
              testid: 'harness-nav-automation',
            })}
            {navItem(t('harness.nav.market'), {
              on: data.viewMode === 'market',
              kbd: '⌘⇧P',
              onClick: () => data.navigate('/market'),
              icon: <Icon icon={Circle} size={15} />,
              testid: 'harness-nav-market',
            })}
          </nav>

          <Sidebar {...sidebar} />

          <div className="sb-foot">
            <button
              type="button"
              className="tb-btn"
              title={t('harness.title.settings')}
              aria-label={t('harness.title.settings')}
              onClick={data.openSettings}
              data-testid="harness-settings"
            >
              <Icon icon={Settings} size={15} />
            </button>
          </div>
        </aside>

        {/* ===== 主区 ===== */}
        <main className="main">
          <div className="main-view" data-testid="harness-main-view">
            <ViewErrorBoundary>{content}</ViewErrorBoundary>
          </div>
          <TerminalDock />
        </main>

        {/* ===== 右 dock（ZCode 式标签条）===== */}
        <aside className="inspector" aria-label={inspectorLabel} data-dock={activeKind ?? ''} data-testid="harness-dock">
          <DockTabBar
            t={t}
            tabs={dock.tabs}
            activeId={dock.activeId}
            fullView={dock.fullView}
            dockWide={dock.wide}
            onActivate={dock.onActivateTab}
            onClose={dock.onCloseTab}
            onReorder={dock.onReorderTab}
            onNewTab={dock.onNewTab}
            onToggleOverview={(anchor) => dock.onToggleOverview(anchor)}
            onToggleFullView={dock.onToggleFullView}
            onToggleDockWide={dock.onToggleWide}
            onCollapse={dock.onCollapse}
            onExitFullView={dock.onToggleFullView}
            onOpenContextMenu={(tabId, anchor) => dock.onOpenContextMenu(tabId, anchor)}
          />
          {!dock.fullView && <DockResizer />}
          <div className="dock-body" data-testid="dock-body">
            <DockPanel />
          </div>
        </aside>
      </div>

      {/* ===== 浮层 ===== */}
      <DockOverlays
        overviewAnchor={dock.overviewAnchor}
        contextMenu={dock.contextMenu}
        onToggleOverview={dock.onToggleOverview}
        onOpenContextMenu={dock.onOpenContextMenu}
        onActivateTab={dock.onActivateTab}
        onReopenClosedTab={dock.onReopenClosedTab}
        onCloseTab={dock.onCloseTab}
        onCloseOthers={dock.onCloseOthers}
        onCloseAll={dock.onCloseAll}
      />
      {harness.inboxOpen && (
        <InboxPanel inboxTab={harness.inboxTab} onNavigateSession={data.navigate} />
      )}
      <CommandPalette {...palette} />
      <SettingsHost open={harness.settingsOpen} onClose={harness.onCloseSettings} />
      <ModalStack suppressInteractionModals={suppressInteraction} />
      <ConfirmDialogHost />
      {toasts.length > 0 && (
        <div className="toast on" role="status" data-testid="harness-toast-host">
          <Toast kind={toasts[0].kind === 'warn' ? 'warning' : toasts[0].kind}
            message={toasts[0].message} durationMs={toasts[0].ttlMs}
            onDismiss={() => onDismissToast(toasts[0].id)} />
        </div>
      )}
    </div>
  );
}
