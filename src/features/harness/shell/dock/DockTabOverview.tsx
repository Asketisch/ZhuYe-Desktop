/**
 * 右 dock 标签总览（ZCode tab overview 同款）。
 *
 * 弹层含搜索框 + 「打开的标签页」/「最近关闭的标签页」两组。
 * 锚定定位由 AnchoredPopover 负责（避开右 dock 滚动裁切）。
 */
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { DockTab } from '@/contracts/harness/shell';
import { DOCK_TAB_META } from '@/render/harness/shell/DockTabBar';
import { Icon } from '@/features/harness/design-system';
import { AnchoredPopover } from '@/features/harness/shell/AnchoredPopover';
import { useI18n } from '@/utils/i18n';

export interface DockTabOverviewProps {
  anchor: HTMLElement | null;
  tabs: DockTab[];
  activeId: string | null;
  recentlyClosedTabs: DockTab[];
  onDismiss: () => void;
  onActivate: (id: string) => void;
  onReopen: (id: string) => void;
}

export function DockTabOverview({
  anchor, tabs, activeId, recentlyClosedTabs, onDismiss, onActivate, onReopen,
}: DockTabOverviewProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const label = (tab: DockTab) =>
    tab.kind === 'files' && tab.seq
      ? `${t(DOCK_TAB_META[tab.kind].labelKey)} ${tab.seq}`
      : t(DOCK_TAB_META[tab.kind].labelKey);
  const matches = (tab: DockTab) => label(tab).toLowerCase().includes(query.trim().toLowerCase());
  const opened = useMemo(() => tabs.filter(matches), [tabs, query]); // eslint-disable-line react-hooks/exhaustive-deps
  const closed = useMemo(() => recentlyClosedTabs.filter(matches), [recentlyClosedTabs, query]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AnchoredPopover anchor={anchor} className="dock-overview" testId="dock-tab-overview" onDismiss={onDismiss}>
      <div className="dock-overview-search">
        <Icon icon={Search} size={13} />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('harness.dock.overviewSearch')}
          aria-label={t('harness.dock.overviewSearch')}
          data-testid="dock-overview-search"
        />
      </div>
      <div className="dock-overview-group">
        <h4>{t('harness.dock.openTabs')}</h4>
        {opened.length === 0 && <p className="dock-overview-empty">{t('harness.dock.overviewEmpty')}</p>}
        {opened.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`dock-overview-row${tab.id === activeId ? ' on' : ''}`}
            onClick={() => { onActivate(tab.id); onDismiss(); }}
          >
            <Icon icon={DOCK_TAB_META[tab.kind].icon} size={13} />
            <span>{label(tab)}</span>
          </button>
        ))}
      </div>
      {recentlyClosedTabs.length > 0 && (
        <div className="dock-overview-group">
          <h4>{t('harness.dock.recentlyClosed')}</h4>
          {closed.length === 0 && <p className="dock-overview-empty">{t('harness.dock.overviewEmpty')}</p>}
          {closed.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className="dock-overview-row"
              onClick={() => { onReopen(tab.id); onDismiss(); }}
            >
              <Icon icon={DOCK_TAB_META[tab.kind].icon} size={13} />
              <span>{label(tab)}</span>
            </button>
          ))}
        </div>
      )}
    </AnchoredPopover>
  );
}
