/**
 * WorkHead + ViewRing —— 对话 frame 的会话头与视图环(v2-shell-redesign)。
 *
 * WorkHead:标题 + git 变更摘要 + 分叉/导出/更多操作(菜单)。
 * 终端/右栏/主题/设置是**窗口级**控制,统一收敛在标题条(TitleBar)——
 * 此处曾以 v2 遗留 store(shellState)自管一套,与标题条状态分裂且
 * 多数接线失效(主题误接右栏开关、设置跳已下线的旧路由),已移除。
 * ViewRing:对话 | 轨迹 视图切换(真实 DSH view-ring 口径)。
 * 两者只在 chat 路由渲染;数据来自既有 store / command,不新增 IPC。
 */
import { useState } from 'react';
import { GitBranch, Ellipsis, Settings, ClipboardCopy, Search } from 'lucide-react';
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
    </div>
  );
}

export function WorkHead({
  title,
  gitSum,
  onFork,
  onExportMarkdown,
  onOpenSettings,
}: {
  title: string;
  gitSum: GitSummary | null;
  onFork: () => void;
  onExportMarkdown: () => void;
  /** 「设置…」菜单项 —— 由 binding 接 shellUi.setSettingsOpen(设置弹窗)。 */
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
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
