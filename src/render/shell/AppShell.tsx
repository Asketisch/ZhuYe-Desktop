/**
 * harness 应用壳（v3 设计稿移植）—— 纯展示组件。
 *
 * 骨架：标题条 + 侧栏（品牌 / 导航 / 会话滚动区 / 用户条）+ 主区（路由视图
 * + 底部终端面板）+ 右 dock（五档）+ 浮层（任务中心 / 命令面板 / 设置）。
 * 主区内容由 TanStack Router 的 <Outlet/> 注入；harness.data.viewMode 仅
 * 用于样式钩子（data-viewmode）。全部状态与监听由 ShellBinding 持有。
 */
import { ChevronRight, Circle, Ellipsis, Plus, Rows3, SquareTerminal } from 'lucide-react';
import type { ShellViewProps } from '@/contracts/shell';
import { Icon } from '../design-system/Icon';

export function AppShell({
  titleBar, sidebar, palette, inspectorOpen, sidebarLabel, inspectorLabel,
  suppressInteraction, toasts, onDismissToast, content, slots, harness,
}: ShellViewProps) {
  const { TitleBar, Sidebar, CommandPalette, ModalStack, Toast,
    ConfirmDialogHost, ViewErrorBoundary, DockPanel, TerminalDock, InboxPanel, SettingsHost } = slots;
  const { data } = harness;
  const { t } = data;
  const { moreMenuOpen } = data;

  const appCls = [
    'app',
    harness.rail ? 'rail' : '',
    inspectorOpen ? '' : 'no-inspector',
    harness.termOpen ? 'term-open' : '',
    harness.dockWide ? 'dock-wide' : '',
    harness.dockMode === 'files' ? 'dock-files' : '',
    harness.dockMode === 'agents' ? 'dock-agents' : '',
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
            {navItem(t('harness.nav.terminal'), {
              on: harness.termOpen,
              kbd: '⌘`',
              onClick: harness.onToggleTerm,
              icon: <Icon icon={SquareTerminal} size={15} />,
              testid: 'harness-nav-term',
            })}
            {navItem(t('harness.nav.market'), {
              on: data.viewMode === 'market',
              kbd: '⌘⇧P',
              onClick: () => data.navigate('/market'),
              icon: <Circle size={15} strokeWidth={1.5} aria-hidden />,
              testid: 'harness-nav-market',
            })}
            {navItem(t('harness.nav.lanes'), {
              on: data.viewMode === 'lanes',
              kbd: '⌘⇧A',
              onClick: () => data.navigate('/lanes'),
              icon: <Rows3 size={15} strokeWidth={1.5} aria-hidden />,
              testid: 'harness-nav-lanes',
            })}
            {navItem(t('harness.nav.tasks'), {
              onClick: () => data.navigate('/tasks'),
              icon: <Icon icon={Circle} size={15} />,
              testid: 'harness-nav-tasks',
            })}
            {/* 更多：其余路由页 + 设置（开关状态在 shellUi，外部关闭在 ShellBinding） */}
            <div style={{ position: 'relative' }} data-more-menu-anchor="">
              {navItem(t('harness.nav.more'), {
                onClick: () => data.onToggleMoreMenu(),
                icon: <Icon icon={Ellipsis} size={15} />,
                testid: 'harness-nav-more',
              })}
              {moreMenuOpen && (
                <div
                  className="sess-menu"
                  style={{ left: 8, right: 'auto', minWidth: 200, maxHeight: '50vh', overflowY: 'auto' }}
                  data-testid="harness-more-menu"
                >
                  {data.morePages.map((page) => (
                    <button
                      key={page.path}
                      type="button"
                      onClick={() => { data.onCloseMoreMenu(); data.navigate(page.path); }}
                    >
                      {page.label}
                    </button>
                  ))}
                  <div className="sep" />
                  <button
                    type="button"
                    onClick={() => { data.onCloseMoreMenu(); data.openSettings(); }}
                    data-testid="harness-more-settings"
                  >
                    {t('harness.title.settings')}
                  </button>
                </div>
              )}
            </div>
          </nav>

          {/* 会话滚动区（旧渲染契约数据 + harness 徽标） */}
          <Sidebar {...sidebar} />

          <div className="sb-foot">
            <span className="avatar">Z</span>
            <span className="who">
              <b>ZhuYe</b>
              <span className="mono">{data.workspaceLabel}</span>
            </span>
            <button
              type="button"
              className="tb-btn"
              title={t('harness.title.settings')}
              aria-label={t('harness.title.settings')}
              onClick={data.openSettings}
              data-testid="harness-settings"
            >
              <Icon icon={Ellipsis} size={15} />
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

        {/* ===== 右 dock（五档）===== */}
        <aside
          className="inspector"
          aria-label={inspectorLabel}
          data-dock={harness.dockMode}
          data-testid="harness-dock"
        >
          <div className="dock-modes">
            {([['inspector', t('harness.dock.inspector')], ['browser', t('harness.dock.browser')],
              ['files', t('harness.dock.files')], ['agents', t('harness.dock.agents')],
              ['usage', t('harness.dock.usage')]] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={`dock-mode${harness.dockMode === mode ? ' on' : ''}`}
                onClick={() => harness.onSetDockMode(mode)}
                data-testid={`harness-dock-mode-${mode}`}
              >
                {label}
              </button>
            ))}
            <span className="tp-spacer" />
            <button
              type="button"
              className={`tb-btn${harness.dockWide ? ' on' : ''}`}
              title={t('harness.dock.wide')}
              aria-label={t('harness.dock.wide')}
              onClick={harness.onToggleDockWide}
              data-testid="harness-dock-wide"
            >
              <Icon icon={ChevronRight} size={14} />
            </button>
          </div>
          <DockPanel />
        </aside>
      </div>

      {/* ===== 浮层 ===== */}
      {harness.inboxOpen && (
        <InboxPanel inboxTab={harness.inboxTab} onNavigateSession={data.navigate} />
      )}
      <CommandPalette {...palette} />
      <SettingsHost open={harness.settingsOpen} onClose={harness.onCloseSettings} />
      <ModalStack suppressInteractionModals={suppressInteraction} />
      <ConfirmDialogHost />
      {/* toast：设计稿为单条居中提示，只展示最新一条。 */}
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
