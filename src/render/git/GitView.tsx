import { GitBranch, GitCommitHorizontal, Check, ArrowRight, ArrowUpToLine, ArrowDownToLine } from 'lucide-react';
import type { GitViewProps } from '@/contracts/git';
import { PageShell } from '../shell/PageShell';
import { Card } from '../design-system/Card';
import { Icon } from '../design-system/Icon';
import { Button } from '../design-system/Button';
import s from './GitView.module.css';

export function GitView({ t, ctrl, WorktreePanel, DiffViewer }: GitViewProps) {
  const { status, diff, tab, setTab, log, error, loading, selected, commitMessage,
    setCommitMessage, mutating, refresh, stagedEntries, workingEntries, listEntries,
    allChecked, toggleEntry, toggleAll, stageOrUnstage, commit } = ctrl;
  if (status && !status.is_repo) {
    return (
      <PageShell icon={GitBranch} title={t('git.title')} subtitle={t('git.notRepo')} width="md">
        <Card level="outlined" padding="md">
          <p className={s.note}>
            {t('git.notRepoDesc')}
          </p>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell icon={GitBranch} title={t('git.title')} subtitle={t('git.subtitle')} width="lg">
      {error && <Card level="outlined" padding="md"><p className={s.error}>{t('common.error')}: {error}</p></Card>}
      {/* Worktree 列表 —— agent 进隔离工作树后,改动是否滞留在那里一眼可见。 */}
      <WorktreePanel />

      <Card level="elevated" padding="md" className={s.headerCard}>
        <div className={s.branchRow}>
          <div className={s.branch}>
            <Icon icon={GitBranch} size={16} />
            <strong data-testid="git-branch">{status?.branch ?? '…'}</strong>
            {status?.upstream && (
              <span className={s.upstream}>↻ {status.upstream}</span>
            )}
          </div>
          <div className={s.arrows}>
            <span title={t('git.ahead')}>↑ {status?.ahead ?? 0}</span>
            <span title={t('git.behind')}>↓ {status?.behind ?? 0}</span>
          </div>
        </div>
        <div className={s.tabs}>
          <button
            type="button"
            className={s.tab}
            data-active={tab === 'working'}
            onClick={() => setTab('working')}
          >
            {t('git.working')} ({workingEntries.length ?? 0})
          </button>
          <button
            type="button"
            className={s.tab}
            data-active={tab === 'staged'}
            onClick={() => setTab('staged')}
          >
            {t('git.staged')} ({stagedEntries.length})
          </button>
        </div>
      </Card>

      <h3 className={s.sectionTitle}>{t('git.changes')}</h3>
      <Card level="flat" padding="none" className={s.entryList}>
        {listEntries.length === 0 ? (
          <div className={s.emptyState}>{t('git.noChanges')}</div>
        ) : (
          <>
            <div className={s.opsRow}>
              <label className={s.checkAll}>
                <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label={t('git.selectAll')} />
                {t('git.selectAll')}
              </label>
              <Button
                size="sm"
                variant="secondary"
                disabled={selected.size === 0 || mutating}
                loading={mutating && selected.size > 0}
                onClick={() => void stageOrUnstage()}
                leftIcon={<Icon icon={tab === 'working' ? ArrowUpToLine : ArrowDownToLine} size={13} />}
                data-testid="git-stage-selected"
              >
                {tab === 'working' ? t('git.stageSelected') : t('git.unstageSelected')}
              </Button>
            </div>
            <ul>
              {listEntries.map((e, i) => (
                <li key={i} className={s.entry}>
                  <input
                    type="checkbox"
                    checked={selected.has(e.path)}
                    onChange={() => toggleEntry(e.path)}
                    aria-label={`${tab === 'working' ? t('git.stageSelected') : t('git.unstageSelected')}: ${e.path}`}
                    data-testid={`git-entry-check-${e.path}`}
                  />
                  <span className={s.status} data-status={e.status}>{e.status}</span>
                  <span className={s.path}>
                    {e.old_path ? `${e.old_path} → ` : ''}{e.path}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {tab === 'staged' && (
        <Card level="flat" padding="md" className={s.commitCard}>
          <textarea
            className={s.commitInput}
            rows={2}
            value={commitMessage}
            placeholder={t('git.commitPlaceholder')}
            onChange={(e) => setCommitMessage(e.target.value)}
            aria-label={t('git.commitPlaceholder')}
            data-testid="git-commit-message"
          />
          <div className={s.commitRow}>
            <span className={s.commitHint}>{t('git.commitHint')}</span>
            <Button
              size="sm"
              variant="primary"
              disabled={!commitMessage.trim() || mutating}
              loading={mutating && Boolean(commitMessage.trim())}
              onClick={() => void commit()}
              leftIcon={<Icon icon={GitCommitHorizontal} size={13} />}
              data-testid="git-commit-btn"
            >
              {t('git.commit')}
            </Button>
          </div>
        </Card>
      )}

      <h3 className={s.sectionTitle}>{t('git.diffTitle', { tab: t(`git.${tab}`) })}</h3>
      <DiffViewer diff={diff} emptyMessage={t('git.noDiff')} />

      <h3 className={s.sectionTitle}>{t('git.commits')}</h3>
      <Card level="flat" padding="none" className={s.logList}>
        {log.length === 0 ? (
          <div className={s.emptyState}>{t('git.noCommits')}</div>
        ) : (
          <ul>
            {log.map((c) => (
              <li key={c.hash} className={s.logRow}>
                <Icon icon={GitCommitHorizontal} size={14} />
                <code className={s.short}>{c.short_hash}</code>
                <span className={s.subject}>{c.subject}</span>
                <span className={s.author}>{c.author}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <button
        type="button"
        onClick={() => void refresh()}
        className={s.refresh}
        disabled={loading}
        data-testid="git-refresh"
      >
        <Icon icon={loading ? Check : ArrowRight} size={14} />
        {loading ? t('git.refreshing') : t('git.refresh')}
      </button>
    </PageShell>
  );
}
