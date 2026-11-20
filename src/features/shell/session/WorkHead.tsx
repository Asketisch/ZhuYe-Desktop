/**
 * WorkHead + ViewRing —— 对话 frame 的会话头与视图环(v2-shell-redesign)。
 *
 * WorkHead:标题 + git 变更摘要 + 分叉/导出/更多操作 + 终端/右栏/主题/设置切换。
 * ViewRing:对话 | 轨迹 视图切换(真实 DSH view-ring 口径)。
 * 两者只在 chat 路由渲染;数据来自既有 store / command,不新增 IPC。
 */
import { useState } from 'react';
import {
  GitBranch, Ellipsis, FileText, SquareTerminal, PanelRight, SunMoon, Settings,
  ClipboardCopy, Search, Sparkles,
} from 'lucide-react';
import { useI18n } from '@/utils/i18n';
import s from '@/render/shell/session/session.module.css';

export { summarizeDiff, useGitSummary } from '@/logic/chat/gitSummary';
import type { GitSummary } from '@/logic/chat/gitSummary';

export function DiffSum({ sum }: { sum: GitSummary | null }) {
  if (!sum || sum.files === 0) return null;
  return (
    <span className={s.gitSum} data-testid="session-git-sum">
      <span style={{ color: 'var(--diff-added)' }}>+{sum.added}</span>{' '}
      <span style={{ color: 'var(--diff-removed)' }}>−{sum.removed}</span>
    </span>
  );
}

export function ViewRing({
  mode,
  onChange,
}: {
  mode: 'chat' | 'traj';
  onChange: (mode: 'chat' | 'traj') => void;
}) {
  const { t } = useI18n();
  return (
    <div className={s.viewring}>
      <div role="tablist" aria-label={t('view.chat')} style={{ display: 'flex', gap: 4 }}>
        <button
          type="button"
          role="tab"
          className={s.vring}
          data-active={mode === 'chat'}
          aria-selected={mode === 'chat'}
          data-testid="viewring-chat"
          onClick={() => onChange('chat')}
        >
          {t('view.chat')}
        </button>
        <button
          type="button"
          role="tab"
          className={s.vring}
          data-active={mode === 'traj'}
          aria-selected={mode === 'traj'}
          data-testid="viewring-traj"
          onClick={() => onChange('traj')}
        >
          {t('view.traj')}
        </button>
      </div>
      <button type="button" className={s.vring} aria-label={t('head.more')}>
        <Ellipsis size={14} />
      </button>
    </div>
  );
}

export function WorkHead({
  title,
  gitSum,
  onFork,
  onExportMarkdown,
  terminalOn,
  onToggleTerminal,
  rightOn,
  onToggleRight,
  onToggleTheme,
  onOpenSettings,
}: {
  title: string;
  gitSum: GitSummary | null;
  onFork: () => void;
  onExportMarkdown: () => void;
  terminalOn: boolean;
  onToggleTerminal: () => void;
  rightOn: boolean;
  onToggleRight: () => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className={s.wshead} data-testid="session-wshead">
      <span className={s.wsTitle} data-testid="session-ws-title">{title}</span>
      <DiffSum sum={gitSum} />
      <div className={s.wsSpring} />
      <div className={s.wsActions}>
        <button type="button" className={s.hbtn} data-testid="session-head-fork" aria-label={t('head.fork')} title={t('head.fork')} onClick={onFork}>
          <GitBranch size={14} />
        </button>
        <div style={{ position: 'relative', display: 'inline-flex' }}>
          <button
            type="button"
            className={s.hbtn}
            data-testid="session-head-more"
            aria-label={t('head.more')}
            title={t('head.more')}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <Ellipsis size={14} />
          </button>
          {menuOpen && (
            <div className={`${s.pop} ${s.popUp}`} style={{ right: 0, left: 'auto', minWidth: 230 }}>
              <div className={s.popHead}><Search size={12} /> {t('head.more')}</div>
              <div className={s.popList}>
                <button type="button" className={s.popRow} onClick={() => { setMenuOpen(false); onExportMarkdown(); }}>
                  <ClipboardCopy size={14} /> {t('threads.exportMarkdown')}
                </button>
                <button type="button" className={s.popRow} onClick={() => { setMenuOpen(false); onFork(); }}>
                  <GitBranch size={14} /> {t('head.fork')}…
                </button>
                <button type="button" className={s.popRow} onClick={() => { setMenuOpen(false); onOpenSettings(); }}>
                  <Settings size={14} /> {t('rail.settings')}…
                </button>
                <div className={s.popHead}><Sparkles size={12} /> {t('view.chat')}</div>
                <button type="button" className={s.popRow} onClick={() => setMenuOpen(false)}>
                  <FileText size={14} /> {title}
                </button>
              </div>
            </div>
          )}
        </div>
        <span style={{ width: 1, height: 16, background: 'var(--border-subtle)', flexShrink: 0 }} />
        <button
          type="button"
          className={s.hbtn}
          data-on={terminalOn}
          data-testid="session-head-terminal"
          aria-label={t('head.terminal')}
          title={t('head.terminal')}
          onClick={onToggleTerminal}
        >
          <SquareTerminal size={14} />
        </button>
        <button
          type="button"
          className={s.hbtn}
          data-on={rightOn}
          data-testid="session-head-right"
          aria-label={t('head.rightPanel')}
          title={t('head.rightPanel')}
          onClick={onToggleRight}
        >
          <PanelRight size={14} />
        </button>
        <button type="button" className={s.hbtn} aria-label={t('head.theme')} title={t('head.theme')} onClick={onToggleTheme}>
          <SunMoon size={14} />
        </button>
        <button type="button" className={s.hbtn} aria-label={t('rail.settings')} title={t('rail.settings')} onClick={onOpenSettings}>
          <Settings size={14} />
        </button>
      </div>
    </div>
  );
}
