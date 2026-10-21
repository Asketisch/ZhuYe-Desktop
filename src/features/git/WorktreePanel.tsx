/**
 * WorktreePanel —— git worktree 列表 + 「改动被困住」告警。
 *
 * agent 经 `EnterWorktree` 进隔离工作树后，GUI 此前**完全不知情** ——
 * 用户的改动可能滞留在那里、没落回主分支（丢工）。核心的 worktree 状态
 * 存在 `ToolContext` 里（进程内），这里从文件系统侧发现：
 * `git worktree list --porcelain` + 核心的 `worktree_dirty` 判脏。
 */
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, GitBranch } from 'lucide-react';
import { Badge, Card, Icon } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { reflect_list_worktrees } from '@/utils/commands/git';
import s from './GitView.module.css';

export function WorktreePanel() {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ['git-worktrees'],
    queryFn: () => reflect_list_worktrees(),
    staleTime: 15_000,
  });
  const worktrees = q.data ?? [];
  if (worktrees.length === 0) return null;
  const stranded = worktrees.filter((w) => w.stranded);

  return (
    <Card level="outlined" padding="md" className={s.worktreeCard} data-testid="git-worktrees">
      <div className={s.worktreeHeader}>
        <Icon icon={GitBranch} size={14} />
        <strong>{t('git.worktrees.title')}</strong>
        <Badge variant="neutral">{worktrees.length}</Badge>
        {stranded.length > 0 && (
          <Badge variant="danger" solid>
            {t('git.worktrees.stranded', { count: String(stranded.length) })}
          </Badge>
        )}
      </div>
      {stranded.length > 0 && (
        <p className={s.worktreeWarn} data-testid="git-worktree-stranded">
          <Icon icon={AlertTriangle} size={12} /> {t('git.worktrees.strandedHint')}
        </p>
      )}
      <ul className={s.worktreeList}>
        {worktrees.map((w) => (
          <li key={w.path} className={s.worktreeRow} data-stranded={w.stranded || undefined}>
            <span className={s.worktreePath} title={w.path}>
              {w.path}
            </span>
            {w.branch && <Badge variant="neutral">{w.branch}</Badge>}
            {w.dirty && <Badge variant="warning">{t('git.worktrees.dirty')}</Badge>}
            {w.isolated && <Badge variant="info">{t('git.worktrees.isolated')}</Badge>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
