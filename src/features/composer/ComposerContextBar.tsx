/**
 * ComposerContextBar —— 输入框下方的上下文条：打开的目录 + git 分支。
 *
 * v1.x 反馈：目录/分支是对话框侧的上下文（当前会话在哪个项目、哪个分支
 * 上工作），不是全局状态 —— 由底部 StatusBar 移到 Composer 控制条之下。
 * 两段都拿不到数据（无工作区 + 非 repo）时整条不渲染。
 */
import { FolderOpen, GitBranch } from 'lucide-react';
import { Icon } from '@/features/design-system';
import { useCurrentWorkspace } from '@/features/shell/hooks/useCurrentWorkspace';
import { useGitStatusSummary } from '@/features/shell/hooks/useGitStatusSummary';
import s from '@/render/composer/ComposerContextBar.module.css';

function basename(p: string): string {
  const parts = p.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || p;
}

export function ComposerContextBar() {
  const { currentWorkspace } = useCurrentWorkspace();
  const { branch, aheadBehind } = useGitStatusSummary(currentWorkspace);

  if (!currentWorkspace && !branch) return null;
  return (
    <div className={s.bar} data-testid="composer-context-bar">
      {currentWorkspace && (
        <span className={s.item} title={currentWorkspace} data-testid="composer-workspace">
          <Icon icon={FolderOpen} size={11} />
          {basename(currentWorkspace)}
        </span>
      )}
      {branch && (
        <span className={s.item} title={branch} data-testid="composer-branch">
          <Icon icon={GitBranch} size={11} /> {branch}
          {aheadBehind}
        </span>
      )}
    </div>
  );
}
