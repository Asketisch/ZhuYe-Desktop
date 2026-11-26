/**
 * 右 dock 标签页条（ZCode side-pane tabs 同款，纯展示）。
 *
 * 布局：最左「标签总览」按钮 → 标签条（28px 胶囊，HTML5 拖拽排序）→
 * 「+」新标签 → 右侧动作组（完整视图 / 宽栏 / 收起）。
 * 完整视图开启时标签条最前出现「对话」胶囊用于返回对话列。
 */
import {
  Bot,
  ChartNoAxesColumn,
  ChevronsDown,
  Folder,
  Gauge,
  GitPullRequest,
  Globe,
  ListTodo,
  Maximize2,
  Minimize2,
  PanelRightClose,
  Plus,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { DockTab } from '@/contracts/harness/shell';
import { Icon } from '../design-system/Icon';

export interface DockTabBarProps {
  t: (key: string) => string;
  tabs: DockTab[];
  activeId: string | null;
  /** 完整视图开启：标签条最前出现「对话」胶囊用于返回对话列。 */
  fullView: boolean;
  dockWide: boolean;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onNewTab: () => void;
  onToggleOverview: (anchor: HTMLElement) => void;
  onToggleFullView: () => void;
  onToggleDockWide: () => void;
  onCollapse: () => void;
  onExitFullView: () => void;
  onOpenContextMenu: (tabId: string, anchor: HTMLElement) => void;
}

/** 每类标签页的展示元数据（图标 + 标题文案键）。 */
export const DOCK_TAB_META: Record<DockTab['kind'], { labelKey: string; icon: LucideIcon }> = {
  inspector: { labelKey: 'harness.dock.inspector', icon: Gauge },
  review: { labelKey: 'harness.dock.review', icon: GitPullRequest },
  files: { labelKey: 'harness.dock.files', icon: Folder },
  browser: { labelKey: 'harness.dock.browser', icon: Globe },
  agents: { labelKey: 'harness.dock.agents', icon: Bot },
  usage: { labelKey: 'harness.dock.usage', icon: ChartNoAxesColumn },
  plan: { labelKey: 'harness.dock.plan', icon: ListTodo },
  'new-tab': { labelKey: 'harness.dock.newTab', icon: Plus },
};

export function DockTabBar({
  t,
  tabs,
  activeId,
  fullView,
  dockWide,
  onActivate,
  onClose,
  onReorder,
  onNewTab,
  onToggleOverview,
  onToggleFullView,
  onToggleDockWide,
  onCollapse,
  onExitFullView,
  onOpenContextMenu,
}: DockTabBarProps) {
  return (
    <div className="dock-tabbar" data-testid="harness-dock-tabbar">
      <button
        type="button"
        className="tb-btn"
        title={t('harness.dock.tabOverview')}
        aria-label={t('harness.dock.tabOverview')}
        onClick={(event) => onToggleOverview(event.currentTarget)}
        data-testid="harness-dock-overview"
      >
        <Icon icon={ChevronsDown} size={15} />
      </button>
      {fullView && (
        <button
          type="button"
          className="dock-tab dock-conversation"
          onClick={onExitFullView}
          data-testid="harness-dock-conversation"
        >
          {t('harness.dock.conversation')}
        </button>
      )}
      <div className="dock-tabstrip" role="group" aria-label={t('harness.dock.tabOverview')} data-testid="dock-tabstrip">
        {tabs.map((tab, index) => {
          const meta = DOCK_TAB_META[tab.kind];
          const label =
            tab.kind === 'files' && tab.seq
              ? `${t(meta.labelKey)} ${tab.seq}`
              : t(meta.labelKey);
          const active = tab.id === activeId;
          return (
            <div
              key={tab.id}
              className={`dock-tab${active ? ' on' : ''}`}
              draggable
              onDragStart={(event) =>
                event.dataTransfer.setData('text/dock-tab-index', String(index))
              }
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const from = Number(event.dataTransfer.getData('text/dock-tab-index'));
                if (Number.isInteger(from) && from !== index) onReorder(from, index);
              }}
              onAuxClick={(event) => {
                // 中键关闭：不激活邻居之外的任何东西（同 ZCode）。
                if (event.button === 1) {
                  event.preventDefault();
                  onClose(tab.id);
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                onOpenContextMenu(tab.id, event.currentTarget);
              }}
              data-testid={`dock-tab-${tab.kind}`}
            >
              <button
                type="button"
                className="dock-tab-main"
                onClick={() => onActivate(tab.id)}
                aria-pressed={active}
              >
                <Icon icon={meta.icon} size={12} />
                <span className="dock-tab-label">{label}</span>
              </button>
              {tab.kind !== 'new-tab' && (
                <button
                  type="button"
                  className="dock-tab-close"
                  aria-label={t('harness.dock.closeTab')}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(tab.id);
                  }}
                >
                  <Icon icon={X} size={10} />
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          className="tb-btn dock-add"
          title={t('harness.dock.addTab')}
          aria-label={t('harness.dock.addTab')}
          onClick={onNewTab}
          data-testid="harness-dock-add-tab"
        >
          <Icon icon={Plus} size={14} />
        </button>
      </div>
      <span className="dock-tabbar-spacer" />
      <div className="dock-tabbar-actions">
        <button
          type="button"
          className={`tb-btn${dockWide ? ' on' : ''}`}
          title={t('harness.dock.wide')}
          aria-label={t('harness.dock.wide')}
          onClick={onToggleDockWide}
          data-testid="harness-dock-wide"
        >
          <Icon icon={ChevronsDown} size={15} className="dock-wide-icon" />
        </button>
        <button
          type="button"
          className="tb-btn"
          title={fullView ? t('harness.dock.exitFullView') : t('harness.dock.fullView')}
          aria-label={fullView ? t('harness.dock.exitFullView') : t('harness.dock.fullView')}
          onClick={onToggleFullView}
          data-testid={fullView ? 'harness-dock-fullview-exit' : 'harness-dock-fullview'}
        >
          <Icon icon={fullView ? Minimize2 : Maximize2} size={15} />
        </button>
        <button
          type="button"
          className="tb-btn"
          title={t('harness.dock.togglePanel')}
          aria-label={t('harness.dock.collapse')}
          onClick={onCollapse}
          data-testid="harness-dock-collapse"
        >
          <Icon icon={PanelRightClose} size={15} />
        </button>
      </div>
    </div>
  );
}
