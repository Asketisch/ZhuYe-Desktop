/**
 * ComposerTopBar —— 输入卡顶栏（surface 层胶囊行）。
 *
 * 双层嵌套输入卡的外层行：工作区胶囊 + 分支胶囊（或 worktree 起点分支
 * 选择器）+「添加工作区」，右簇为运行位置（本地 / 远端主机）与 worktree
 * 隔离开关。原输入卡下方的上下文条（工作区 / 运行位置 / git 分支）收编
 * 进本行 —— 「这个会话在哪个目录、哪个分支上工作」是输入框侧的上下文。
 *
 * worktree 开关只是**草稿意图**（agentStore.worktreeIntent）：勾选 =
 * 下一个新会话在隔离 worktree 中运行，起点分支由起点分支选择器登记，
 * 建树发生在发送瞬间（见 useComposerSubmission）。当前会话已在隔离
 * worktree 时开关转只读指示态。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor, Plus } from 'lucide-react';
import { Icon } from '@/features/harness/design-system';
import { useI18n } from '@/utils/i18n';
import { useCurrentWorkspace } from '@/logic/shell/useCurrentWorkspace';
import { zhuye_git_status, zhuye_list_worktrees } from '@/utils/commands/git';
import { zhuye_remote_sessions } from '@/utils/commands/remote';
import {
  zhuye_pick_workspace_folder,
  zhuye_set_workspace,
} from '@/utils/commands/workspaces';
import { useAgentStore } from '@/stores/agentStore';
import { WorkspaceMenu, invalidateWorkspaceQueries } from './WorkspaceMenu';
import { BranchMenu, StartRefPicker } from './BranchMenu';
import s from '@/render/composer/ComposerTopBar.module.css';

/** 路径等价比较（去尾斜杠直比；worktree 落盘路径无符号链接歧义）。 */
function samePath(a: string, b: string): boolean {
  return a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
}

export function ComposerTopBar() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const pushToast = useAgentStore((st) => st.pushToast);
  const { currentWorkspace } = useCurrentWorkspace();
  const worktreeIntent = useAgentStore((st) => st.worktreeIntent);
  const setWorktreeIntent = useAgentStore((st) => st.setWorktreeIntent);

  // git 摘要（分支 / 脏文件数 / ↑↓）：切工作区或 checkout 后由 key 失效驱动刷新。
  const { data: gitStatus } = useQuery({
    queryKey: ['git-status'],
    queryFn: zhuye_git_status,
    staleTime: 15_000,
  });
  const branch = gitStatus?.is_repo ? gitStatus.branch : null;
  const dirtyCount = gitStatus?.entries.length ?? 0;
  const aheadBehind =
    gitStatus && gitStatus.ahead + gitStatus.behind > 0
      ? ` ↑${gitStatus.ahead} ↓${gitStatus.behind}`
      : '';

  // worktree 列表：判定当前会话是否已运行在隔离 worktree 中。
  const { data: worktrees } = useQuery({
    queryKey: ['git-worktrees'],
    queryFn: zhuye_list_worktrees,
    staleTime: 15_000,
  });
  const inWorktree =
    !!currentWorkspace &&
    (worktrees ?? []).some((w) => w.isolated && samePath(w.path, currentWorkspace));

  // 运行位置：默认本地；存在远端会话时显示主机名（SSH 远程开发）。
  const { data: remoteSessions } = useQuery({
    queryKey: ['remote-sessions'],
    queryFn: zhuye_remote_sessions,
    staleTime: 30_000,
  });
  const remoteHost =
    remoteSessions?.find((session) => session.isForeground)?.host
    ?? remoteSessions?.[0]?.host;

  const addWorkspace = async () => {
    try {
      const picked = await zhuye_pick_workspace_folder();
      if (!picked) return;
      // 显式添加 = 用户意图使用该工作区：unhide 复活已移除的条目
      // （否则移除过的目录在这里添加不回来，只能去管理页点恢复）。
      await zhuye_set_workspace(picked, true);
      invalidateWorkspaceQueries(qc);
    } catch (e) {
      pushToast({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className={s.bar} data-testid="composer-top-bar">
      <WorkspaceMenu currentWorkspace={currentWorkspace} />
      {worktreeIntent ? (
        <StartRefPicker selectedRef={worktreeIntent.ref} currentBranchLabel={branch} />
      ) : (
        branch && (
          <BranchMenu currentBranch={branch} dirtyCount={dirtyCount} aheadBehind={aheadBehind} />
        )
      )}
      <button
        type="button"
        className={s.addButton}
        onClick={() => void addWorkspace()}
        title={t('composer.top.addWorkspace')}
        aria-label={t('composer.top.addWorkspace')}
        data-testid="composer-add-workspace"
      >
        <Icon icon={Plus} size={14} />
      </button>

      <div className={s.barRight}>
        <span
          className={`${s.pill} ${s.pillStatic}`}
          title={remoteHost ?? t('composer.context.local')}
          data-testid="composer-runtime-pill"
        >
          <Icon icon={Monitor} size={14} className={s.pillIcon} />
          <span className={s.pillLabel}>{remoteHost ?? t('composer.context.local')}</span>
        </span>
        {branch && (
          <label
            className={s.toggle}
            title={inWorktree ? t('composer.worktree.inWorktreeHint') : t('composer.worktree.toggleHint')}
            data-testid="composer-worktree-toggle"
            data-static={inWorktree || undefined}
          >
            <input
              type="checkbox"
              className={s.toggleBox}
              checked={inWorktree || worktreeIntent !== null}
              disabled={inWorktree}
              onChange={(e) => setWorktreeIntent(e.target.checked ? { ref: null } : null)}
            />
            <span>{t('composer.worktree.label')}</span>
          </label>
        )}
      </div>
    </div>
  );
}
