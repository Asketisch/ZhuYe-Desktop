/**
 * ComposerContextBar —— 输入框下方的上下文条：工作区 + 运行位置 + git 分支。
 *
 * v1.x 反馈：目录/分支是对话框侧的上下文（当前会话在哪个项目、哪个分支
 * 上工作），不是全局状态 —— 由底部 StatusBar 移到 Composer 控制条之下。
 * v3 harness：按 minimax code 的底部布局，卡片下方一行给出「工作区 /
 * 运行位置 / 分支」三段；运行位置默认「本地」，有远端会话时显示主机名。
 */
import { useQuery } from '@tanstack/react-query';
import { FolderOpen, GitBranch, Monitor } from 'lucide-react';
import { Icon } from '@/features/design-system';
import { useCurrentWorkspace } from '@/features/shell/hooks/useCurrentWorkspace';
import { useGitStatusSummary } from '@/features/shell/hooks/useGitStatusSummary';
import { useI18n } from '@/utils/i18n';
import { zhuye_remote_sessions } from '@/utils/commands/remote';
import s from '@/render/composer/ComposerContextBar.module.css';

function basename(p: string): string {
  const parts = p.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || p;
}

export function ComposerContextBar() {
  const { t } = useI18n();
  const { currentWorkspace } = useCurrentWorkspace();
  const { branch, aheadBehind } = useGitStatusSummary(currentWorkspace);
  // 运行位置：默认本地；存在远端会话时显示主机名（SSH 远程开发）。
  const { data: remoteSessions } = useQuery({
    queryKey: ['remote-sessions'],
    queryFn: zhuye_remote_sessions,
    staleTime: 30_000,
  });
  const remoteHost = remoteSessions?.find((session) => session.isForeground)?.host
    ?? remoteSessions?.[0]?.host;

  if (!currentWorkspace && !branch && !remoteHost) return null;
  return (
    <div className={s.bar} data-testid="composer-context-bar">
      {currentWorkspace && (
        <span className={s.item} title={currentWorkspace} data-testid="composer-workspace">
          <Icon icon={FolderOpen} size={11} />
          {basename(currentWorkspace)}
        </span>
      )}
      <span className={s.item} title={remoteHost ?? t('composer.context.local')} data-testid="composer-runtime">
        <Icon icon={Monitor} size={11} />
        {remoteHost ?? t('composer.context.local')}
      </span>
      {branch && (
        <span className={s.item} title={branch} data-testid="composer-branch">
          <Icon icon={GitBranch} size={11} /> {branch}
          {aheadBehind}
        </span>
      )}
    </div>
  );
}
