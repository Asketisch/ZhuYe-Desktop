import { Bell, Contrast, Command, PanelLeft, PanelRight, Moon, Sun, SquareTerminal } from 'lucide-react';
import type { TitleBarProps } from '@/contracts/titleBar';
import { Icon } from '../design-system/Icon';

/**
 * harness 标题条（v3 设计稿移植）。
 *
 * 布局：红绿灯避让区 → rail 开关 → 工作区标题 → 弹性空隙 → 右侧动作组
 * （任务中心铃铛+角标 / 终端 / dock / 命令面板 / 单色 / 主题）。
 * macOS Overlay 红绿灯由系统绘制，这里只留避让宽度。
 */
export function TitleBar(props: TitleBarProps) {
  const {
    t, workspaceLabel, pendingCount,
    onToggleSidebar, onToggleTerm, termOpen, onToggleInspector, inspectorOpen,
    onOpenPalette, onOpenInbox, semantic, onToggleSemantic, resolvedTheme, onToggleTheme,
    dockMode, onSetDockMode,
  } = props;
  return (
    <header className="titlebar" data-tauri-drag-region data-testid="harness-titlebar">
      <button
        type="button"
        className="tb-btn"
        title={t('harness.title.rail')}
        aria-label={t('harness.title.rail')}
        onClick={onToggleSidebar}
        data-testid="harness-rail"
      >
        <Icon icon={PanelLeft} size={15} />
      </button>
      <span className="tb-title mono" data-testid="harness-workspace-label">{workspaceLabel}</span>
      <span className="tb-spacer" />
      <div className="tb-actions">
        {/* 任务中心：待批准 / 待回答 / 后台完成的汇总入口 */}
        <button
          type="button"
          className="tb-btn tb-bell"
          title={t('harness.inbox.title')}
          aria-label={t('harness.inbox.title')}
          onClick={onOpenInbox}
          data-testid="harness-inbox"
        >
          <Icon icon={Bell} size={15} />
          <span className="tb-badge" hidden={pendingCount === 0} data-testid="harness-inbox-badge">{pendingCount}</span>
        </button>
        {/* 终端面板 */}
        <button
          type="button"
          className={`tb-btn${termOpen ? ' on' : ''}`}
          title={t('harness.title.term')}
          aria-label={t('harness.title.term')}
          onClick={onToggleTerm}
          data-testid="harness-term"
        >
          <Icon icon={SquareTerminal} size={15} />
        </button>
        {/* 右 dock：检查器开合 */}
        <button
          type="button"
          className={`tb-btn${inspectorOpen ? ' on' : ''}`}
          title={t('harness.title.inspect')}
          aria-label={t('harness.title.inspect')}
          onClick={onToggleInspector}
          data-testid="harness-inspect"
        >
          <Icon icon={PanelRight} size={15} />
        </button>
        {/* dock 快捷档位：浏览器 / 文件 / 用量（点按直达对应档位） */}
        <button
          type="button"
          className={`tb-btn${dockMode === 'browser' && inspectorOpen ? ' on' : ''}`}
          title={t('harness.dock.browser')}
          aria-label={t('harness.dock.browser')}
          onClick={() => onSetDockMode('browser')}
          data-testid="harness-dock-browser"
        >
          <span className="mono" style={{ fontSize: 12 }}>◧</span>
        </button>
        <button
          type="button"
          className={`tb-btn${dockMode === 'files' && inspectorOpen ? ' on' : ''}`}
          title={t('harness.dock.files')}
          aria-label={t('harness.dock.files')}
          onClick={() => onSetDockMode('files')}
          data-testid="harness-dock-files"
        >
          <span className="mono" style={{ fontSize: 12 }}>▤</span>
        </button>
        <button
          type="button"
          className={`tb-btn${dockMode === 'usage' && inspectorOpen ? ' on' : ''}`}
          title={t('harness.dock.usage')}
          aria-label={t('harness.dock.usage')}
          onClick={() => onSetDockMode('usage')}
          data-testid="harness-dock-usage"
        >
          <span className="mono" style={{ fontSize: 12 }}>◒</span>
        </button>
        {/* 命令面板 */}
        <button
          type="button"
          className="tb-btn"
          title={t('harness.title.palette')}
          aria-label={t('harness.title.palette')}
          onClick={onOpenPalette}
          data-testid="harness-palette"
        >
          <Icon icon={Command} size={15} />
        </button>
        {/* 单色 / 语义色 */}
        <button
          type="button"
          className={`tb-btn${semantic === 'off' ? ' on' : ''}`}
          title={t('harness.title.mono')}
          aria-label={t('harness.title.mono')}
          onClick={onToggleSemantic}
          data-testid="harness-mono"
        >
          <Icon icon={Contrast} size={15} />
        </button>
        {/* 亮色 / 暗色 */}
        <button
          type="button"
          className="tb-btn"
          title={t('harness.title.theme')}
          aria-label={t('harness.title.theme')}
          onClick={onToggleTheme}
          data-testid="harness-theme"
        >
          <Icon icon={resolvedTheme === 'dark' ? Moon : Sun} size={15} />
        </button>
      </div>
    </header>
  );
}
