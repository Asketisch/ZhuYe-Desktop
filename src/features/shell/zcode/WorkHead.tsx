/**
 * WorkHead + ViewRing —— 对话 frame 的会话头与视图环(redesign/zcode-shell)。
 *
 * WorkHead:标题 + git 变更摘要 + 分叉/导出/更多操作 + 终端/右栏/主题/设置切换。
 * ViewRing:对话 | 轨迹 视图切换(真实 DSH view-ring 口径)。
 * 两者只在 chat 路由渲染;数据来自既有 store / command,不新增 IPC。
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  GitBranch, Ellipsis, FileText, SquareTerminal, PanelRight, SunMoon, Settings,
  ClipboardCopy, Search, Sparkles,
} from 'lucide-react';
import { useI18n } from '@/utils/i18n';
import { reflect_git_diff, reflect_git_status } from '@/utils/commands/git';
import s from './zcode.module.css';

export interface GitSummary {
  files: number;
  added: number;
  removed: number;
}

/** 从 unified diff 文本统计 +/− 行(排除 +++/--- 头)。 */
export function summarizeDiff(diff: string): GitSummary {
  let added = 0;
  let removed = 0;
  let files = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff ')) files += 1;
    else if (line.startsWith('+') && !line.startsWith('+++')) added += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) removed += 1;
  }
  return { files, added, removed };
}

/** git 变更摘要(15s stale,chat 头右上角 +N −N)。 */
export function useGitSummary(enabled: boolean): GitSummary | null {
  const status = useQuery({
    queryKey: ['zcode-git-status'],
    queryFn: reflect_git_status,
    enabled,
    staleTime: 15_000,
  });
  const diff = useQuery({
    queryKey: ['zcode-git-diff-stat'],
    queryFn: () => reflect_git_diff(false),
    enabled,
    staleTime: 15_000,
  });
  if (!enabled || !status.data?.is_repo) return null;
  const sum = diff.data != null ? summarizeDiff(diff.data) : null;
  const files = sum?.files ?? status.data.entries.length;
  return { files, added: sum?.added ?? 0, removed: sum?.removed ?? 0 };
}

export function DiffSum({ sum }: { sum: GitSummary | null }) {
  if (!sum || sum.files === 0) return null;
  return (
    <span className={s.gitSum} data-testid="zcode-git-sum">
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
      <div role="tablist" aria-label={t('zcode.view.chat')} style={{ display: 'flex', gap: 4 }}>
        <button
          type="button"
          role="tab"
          className={s.vring}
          data-active={mode === 'chat'}
          aria-selected={mode === 'chat'}
          data-testid="viewring-chat"
          onClick={() => onChange('chat')}
        >
          {t('zcode.view.chat')}
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
          {t('zcode.view.traj')}
        </button>
      </div>
      <button type="button" className={s.vring} aria-label={t('zcode.head.more')}>
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
    <div className={s.wshead} data-testid="zcode-wshead">
      <span className={s.wsTitle} data-testid="zcode-ws-title">{title}</span>
      <DiffSum sum={gitSum} />
      <div className={s.wsSpring} />
      <div className={s.wsActions}>
        <button type="button" className={s.hbtn} data-testid="zcode-head-fork" aria-label={t('zcode.head.fork')} title={t('zcode.head.fork')} onClick={onFork}>
          <GitBranch size={14} />
        </button>
        <div style={{ position: 'relative', display: 'inline-flex' }}>
          <button
            type="button"
            className={s.hbtn}
            data-testid="zcode-head-more"
            aria-label={t('zcode.head.more')}
            title={t('zcode.head.more')}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <Ellipsis size={14} />
          </button>
          {menuOpen && (
            <div className={`${s.pop} ${s.popUp}`} style={{ right: 0, left: 'auto', minWidth: 230 }}>
              <div className={s.popHead}><Search size={12} /> {t('zcode.head.more')}</div>
              <div className={s.popList}>
                <button type="button" className={s.popRow} onClick={() => { setMenuOpen(false); onExportMarkdown(); }}>
                  <ClipboardCopy size={14} /> {t('threads.exportMarkdown')}
                </button>
                <button type="button" className={s.popRow} onClick={() => { setMenuOpen(false); onFork(); }}>
                  <GitBranch size={14} /> {t('zcode.head.fork')}…
                </button>
                <button type="button" className={s.popRow} onClick={() => { setMenuOpen(false); onOpenSettings(); }}>
                  <Settings size={14} /> {t('zcode.rail.settings')}…
                </button>
                <div className={s.popHead}><Sparkles size={12} /> {t('zcode.view.chat')}</div>
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
          data-testid="zcode-head-terminal"
          aria-label={t('zcode.head.terminal')}
          title={t('zcode.head.terminal')}
          onClick={onToggleTerminal}
        >
          <SquareTerminal size={14} />
        </button>
        <button
          type="button"
          className={s.hbtn}
          data-on={rightOn}
          data-testid="zcode-head-right"
          aria-label={t('zcode.head.rightPanel')}
          title={t('zcode.head.rightPanel')}
          onClick={onToggleRight}
        >
          <PanelRight size={14} />
        </button>
        <button type="button" className={s.hbtn} aria-label={t('zcode.head.theme')} title={t('zcode.head.theme')} onClick={onToggleTheme}>
          <SunMoon size={14} />
        </button>
        <button type="button" className={s.hbtn} aria-label={t('zcode.rail.settings')} title={t('zcode.rail.settings')} onClick={onOpenSettings}>
          <Settings size={14} />
        </button>
      </div>
    </div>
  );
}
