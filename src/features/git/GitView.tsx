/**
 * Git —— 通过 reflect_git_status / diff / log 直接展示 (B6)。
 *
 * v1.x P3 操作化：此前只读 —— 现在 working / staged 两个 tab 的条目
 * 支持勾选 + Stage selected / Unstage selected（`reflect_git_stage` /
 * `reflect_git_unstage`），并新增提交框（`reflect_git_commit`，成功后
 * toast + 刷新）。push/pull 仍留给用户终端（远端凭证不进 GUI）。
 */
import { useEffect, useRef, useState } from 'react';
import {
  GitBranch,
  GitCommitHorizontal,
  Check,
  ArrowRight,
  ArrowUpToLine,
  ArrowDownToLine,
} from 'lucide-react';
import {
  reflect_git_status,
  reflect_git_diff,
  reflect_git_log,
  reflect_git_stage,
  reflect_git_unstage,
  reflect_git_commit,
  type ReflectGitStatus,
  type ReflectGitLogEntry,
} from '@/utils/commands';
import { PageShell } from '@/features/shell/PageShell';
import { Card, Icon, Button } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { useAgentStore } from '@/stores/agentStore';
import { DiffViewer } from './DiffViewer';
import { WorktreePanel } from './WorktreePanel';
import s from './GitView.module.css';

type Tab = 'working' | 'staged';

export function GitView() {
  const { t } = useI18n();
  const pushToast = useAgentStore((st) => st.pushToast);
  const [status, setStatus] = useState<ReflectGitStatus | null>(null);
  const [diff, setDiff] = useState('');
  const [tab, setTab] = useState<Tab>('working');
  const [log, setLog] = useState<ReflectGitLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // P3：勾选的路径（按 tab 独立语义 —— working 里是待 stage，staged 里是待 unstage）
  // + 提交信息 + 操作互斥锁。
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [commitMessage, setCommitMessage] = useState('');
  const [mutating, setMutating] = useState(false);

  // 单调请求令牌：tab 快速切换时两次 in-flight 刷新可能乱序 resolve,
  // 后完成的旧请求会把 diff 覆盖成另一个 tab 的内容。
  const seqRef = useRef(0);

  const refresh = async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    try {
      const [s_, d_, l_] = await Promise.all([
        reflect_git_status(),
        reflect_git_diff(tab === 'staged'),
        reflect_git_log(20),
      ]);
      if (seq !== seqRef.current) return;
      setStatus(s_);
      setDiff(d_);
      setLog(l_);
      setSelected(new Set());
    } catch (e) {
      if (seq !== seqRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const entries = status?.entries ?? [];
  // staged 字段(后端从 porcelain index 列推导)区分「已暂存」与「仅工作区」
  // —— trimmed status 码把 "M "/" M" 折叠成同一个 "M",不能用来分 tab。
  // - staged tab:含 index 变更的条目(A/M/D/R...)。
  // - working tab:含工作区变更的条目(未暂存,或 "MM"/"AM" 这类暂存后
  //   又改的 —— 两者都出现);A/R(纯暂存操作)不出现在 working。
  const stagedEntries = entries.filter((e) => e.staged);
  const workingEntries = entries.filter(
    (e) => !e.staged || (e.status.length > 1 && e.status[1] !== ' '),
  );
  const listEntries = tab === 'working' ? workingEntries : stagedEntries;
  const allChecked = listEntries.length > 0 && listEntries.every((e) => selected.has(e.path));

  const toggleEntry = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allChecked ? new Set() : new Set(listEntries.map((e) => e.path)));
  };

  const stageOrUnstage = async () => {
    const paths = [...selected];
    if (paths.length === 0 || mutating) return;
    setMutating(true);
    try {
      if (tab === 'working') await reflect_git_stage(paths);
      else await reflect_git_unstage(paths);
      await refresh();
    } catch (e) {
      pushToast({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setMutating(false);
    }
  };

  const commit = async () => {
    const message = commitMessage.trim();
    if (!message || mutating) return;
    setMutating(true);
    try {
      const short = await reflect_git_commit(message);
      pushToast({ kind: 'success', message: t('git.commitDone', { short }) });
      setCommitMessage('');
      await refresh();
    } catch (e) {
      pushToast({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setMutating(false);
    }
  };

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
