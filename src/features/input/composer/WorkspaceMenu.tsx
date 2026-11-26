/**
 * WorkspaceMenu —— 输入卡顶栏的工作区胶囊：当前工作区名 + 向上弹菜单。
 *
 * 菜单内容：已知工作区列表（当前项打勾，点击即切换并复活已移除条目）+
 * 「打开其他文件夹…」（系统目录选择器，同样 unhide）+「管理工作区…」
 * （跳转管理页）。切换走 `zhuye_set_workspace`，成功后失效工作区 /
 * 会话 / git 相关查询让顶栏与消息流同步刷新。
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Check, ChevronDown, FolderOpen, FolderPlus, Settings2 } from 'lucide-react';
import { Icon } from '@/features/harness/design-system';
import { useI18n } from '@/utils/i18n';
import {
  zhuye_list_workspaces,
  zhuye_pick_workspace_folder,
  zhuye_set_workspace,
  type ZhuyeWorkspaceInfo,
} from '@/utils/commands/workspaces';
import { CURRENT_WORKSPACE_QUERY_KEY } from '@/logic/harness/shell/useCurrentWorkspace';
import { SESSIONS_QUERY_KEY, WORKSPACES_QUERY_KEY } from '@/logic/conversation/sessions/useSessions';
import { isPlaceholderWorkspace } from '@/logic/conversation/sessions/workspaceGroups';
import { useAgentStore } from '@/stores/agentStore';
import s from '@/render/input/composer/ComposerTopBar.module.css';

function basename(p: string): string {
  const parts = p.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || p;
}

/**
 * 切换工作区后需要失效的查询：工作区注册表 + 当前工作区 + 会话列表 +
 * git 上下文。注册表（`['workspaces']`，zhuye_list_workspaces）必须在内 ——
 * set_workspace 会 upsert workspaces.json，侧栏空项目组来自该查询，
 * 漏失效表现为「添加工作区后侧栏不刷新」（实测 bug）。
 */
export function invalidateWorkspaceQueries(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: CURRENT_WORKSPACE_QUERY_KEY });
  void qc.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY });
  void qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
  void qc.invalidateQueries({ queryKey: ['git-status'] });
  void qc.invalidateQueries({ queryKey: ['git-worktrees'] });
}

export function WorkspaceMenu({ currentWorkspace }: { currentWorkspace: string | null }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const pushToast = useAgentStore((st) => st.pushToast);
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<ZhuyeWorkspaceInfo[] | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 菜单每次打开都重取工作区列表（管理页的增删即时反映）。
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    zhuye_list_workspaces()
      .then((list) => { if (!disposed) setWorkspaces(list); })
      .catch(() => { if (!disposed) setWorkspaces([]); });
    return () => { disposed = true; };
  }, [open]);

  // 点击外部关闭（与「+」菜单同款约定）。
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // 菜单点选 / 打开其他文件夹都是显式意图：unhide 复活已移除的工作区
  // （点击历史条目即恢复，不必再去管理页点「恢复」）。
  const switchMutation = useMutation({
    mutationFn: ({ path, unhide }: { path: string; unhide: boolean }) =>
      zhuye_set_workspace(path, unhide),
    onSuccess: () => {
      invalidateWorkspaceQueries(qc);
    },
    onError: (e) => pushToast({ kind: 'error', message: String(e) }),
  });

  const pickAndSwitch = async () => {
    setOpen(false);
    try {
      const picked = await zhuye_pick_workspace_folder();
      if (picked) await switchMutation.mutateAsync({ path: picked, unhide: true });
    } catch (e) {
      pushToast({ kind: 'error', message: String(e) });
    }
  };

  const switchTo = async (path: string) => {
    setOpen(false);
    if (path === currentWorkspace) return;
    await switchMutation.mutateAsync({ path, unhide: true });
  };

  // 占位工作区(cwd 解析失败的「.」等)显示「默认」,不裸显目录符号。
  const label = !currentWorkspace
    ? t('composer.top.noWorkspace')
    : isPlaceholderWorkspace(currentWorkspace)
      ? t('common.workspaceDefault')
      : basename(currentWorkspace);

  return (
    <div className={s.pillWrap} ref={wrapRef} data-testid="composer-workspace-menu">
      <button
        type="button"
        className={s.pill}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={currentWorkspace ?? undefined}
        data-testid="composer-workspace-pill"
      >
        <Icon icon={FolderOpen} size={14} className={s.pillIcon} />
        <span className={s.pillLabel}>{label}</span>
        <Icon icon={ChevronDown} size={12} className={s.pillCaret} />
      </button>

      {open && (
        <div className={s.menu} role="menu" data-testid="composer-workspace-list">
          {(workspaces ?? []).length === 0 && (
            <span className={s.menuEmpty}>{t('composer.top.emptyWorkspaces')}</span>
          )}
          <div className={s.menuScroll}>
            {(workspaces ?? []).map((ws) => {
              const isCurrent = ws.path === currentWorkspace;
              return (
                <button
                  key={ws.path}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isCurrent || undefined}
                  className={s.menuItem}
                  title={ws.path}
                  onClick={() => void switchTo(ws.path)}
                >
                  <span className={s.menuItemLabel}>{ws.label || basename(ws.path)}</span>
                  {isCurrent && <Icon icon={Check} size={14} className={s.menuItemCheck} />}
                </button>
              );
            })}
          </div>
          <div className={s.menuSeparator} role="separator" />
          <button
            type="button"
            role="menuitem"
            className={s.menuFooterAction}
            onClick={() => void pickAndSwitch()}
            data-testid="composer-workspace-add"
          >
            <Icon icon={FolderPlus} size={14} />
            <span className={s.menuItemLabel}>{t('composer.top.openFolder')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={s.menuFooterAction}
            onClick={() => {
              setOpen(false);
              void navigate({ to: '/workspaces' });
            }}
            data-testid="composer-workspace-manage"
          >
            <Icon icon={Settings2} size={14} />
            <span className={s.menuItemLabel}>{t('composer.top.manageWorkspaces')}</span>
          </button>
        </div>
      )}
    </div>
  );
}
