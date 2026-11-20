import { useQuery } from '@tanstack/react-query';
import { zhuye_git_diff, zhuye_git_status } from '@/utils/commands/git';

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
    queryFn: zhuye_git_status,
    enabled,
    staleTime: 15_000,
  });
  const diff = useQuery({
    queryKey: ['zcode-git-diff-stat'],
    queryFn: () => zhuye_git_diff(false),
    enabled,
    staleTime: 15_000,
  });
  if (!enabled || !status.data?.is_repo) return null;
  const sum = diff.data != null ? summarizeDiff(diff.data) : null;
  const files = sum?.files ?? status.data.entries.length;
  return { files, added: sum?.added ?? 0, removed: sum?.removed ?? 0 };
}
