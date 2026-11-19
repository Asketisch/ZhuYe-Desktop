/**
 * useGitStatusSummary —— 当前工作区的 git 分支摘要（branch + ↑↓ 领先/落后）。
 *
 * 供 Composer 下方的上下文条消费（"我在哪个目录、哪个分支"是对话框侧
 * 的上下文信息，v1.x 反馈后由全局 StatusBar 移入）。非 repo / git 命令
 * 失败时 branch 为 null（UI 不显示分支段）。
 *
 * 数据获取用 useEffect + useState 而非 react-query —— 同 ComposerControls
 * 的取舍：保证 Composer 在任意测试挂载环境可用。工作区切换或窗口重新
 * 聚焦时重取（用户常在终端切分支，状态栏不再轮询兜底）。
 */
import { useEffect, useState } from 'react';
import { reflect_git_status } from '@/utils/commands/git';

export interface GitStatusSummary {
  /** 当前分支名；非 repo / 不可用时为 null。 */
  branch: string | null;
  /** `↑N ↓N` 后缀；无领先/落后时为空串。 */
  aheadBehind: string;
}

export function useGitStatusSummary(workspace: string | null): GitStatusSummary {
  const [summary, setSummary] = useState<GitStatusSummary>({ branch: null, aheadBehind: '' });

  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    const load = () => {
      reflect_git_status()
        .then((status) => {
          if (cancelled) return;
          setSummary({
            branch: status.is_repo ? status.branch : null,
            aheadBehind:
              status.ahead + status.behind > 0 ? ` ↑${status.ahead} ↓${status.behind}` : '',
          });
        })
        .catch(() => {
          /* 非 repo / git 不可用 → 不显示分支段 */
        });
    };
    load();
    window.addEventListener('focus', load);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', load);
    };
  }, [workspace]);

  return summary;
}
