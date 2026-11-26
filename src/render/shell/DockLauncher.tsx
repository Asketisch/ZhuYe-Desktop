/**
 * 右 dock「新标签页」启动器（ZCode new-tab launcher 同款，纯展示）。
 *
 * 网格条目：检查器 / 文件 / 浏览器 / 审查 / 子代理 / 用量；有计划时追加「计划」。
 * 终端保留底部面板、不进启动器（用户已确认）；ZCode 的部署/辅助对话在
 * 烛夜无侧栏等价物，不列入。
 */
import type { DockTabKind } from '@/contracts/harness/shell';
import { DOCK_TAB_META } from './DockTabBar';
import { Icon } from '../design-system/Icon';
import { ArrowRight } from 'lucide-react';

export interface DockLauncherProps {
  t: (key: string) => string;
  /** 当前会话是否已有计划（有则显示「计划」条目）。 */
  hasPlan: boolean;
  onOpen: (kind: Exclude<DockTabKind, 'new-tab'>) => void;
}

const ENTRIES: { kind: Exclude<DockTabKind, 'new-tab'>; descKey: string }[] = [
  { kind: 'inspector', descKey: 'harness.launcher.inspectorDesc' },
  { kind: 'files', descKey: 'harness.launcher.filesDesc' },
  { kind: 'browser', descKey: 'harness.launcher.browserDesc' },
  { kind: 'review', descKey: 'harness.launcher.reviewDesc' },
  { kind: 'agents', descKey: 'harness.launcher.agentsDesc' },
  { kind: 'usage', descKey: 'harness.launcher.usageDesc' },
];

export function DockLauncher({ t, hasPlan, onOpen }: DockLauncherProps) {
  const entries = hasPlan
    ? [...ENTRIES, { kind: 'plan' as const, descKey: 'harness.launcher.planDesc' }]
    : ENTRIES;
  return (
    <div className="dock-launcher" data-testid="dock-launcher">
      <h2 className="dock-launcher-title">{t('harness.dock.newTab')}</h2>
      <div className="dock-launcher-grid">
        {entries.map(({ kind, descKey }) => {
          const meta = DOCK_TAB_META[kind];
          return (
            <button
              key={kind}
              type="button"
              className="dock-launcher-item"
              onClick={() => onOpen(kind)}
              data-testid={`dock-launcher-${kind}`}
            >
              <span className="dock-launcher-ico"><Icon icon={meta.icon} size={20} /></span>
              <span className="dock-launcher-text">
                <b>{t(meta.labelKey)}</b>
                <small>{t(descKey)}</small>
              </span>
              <span className="dock-launcher-open">
                {t('harness.launcher.open')} <Icon icon={ArrowRight} size={11} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
