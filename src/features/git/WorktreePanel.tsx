/**
 * WorktreePanel —— git worktree 完整管理面（列表 / 新建 / 删除 / 一键开会话）。
 *
 * 实现下沉 `app-core::worktree`（porcelain 解析 / 增删 / 判脏），本面板
 * 纯消费：
 * - 新建：内联表单（名称 = 缺省同名分支；可选已有分支）；
 * - 在此开会话：切 workspace → 导航新对话首页（与 ShellBinding 同款；
 *   会话在首条消息发出时才创建，worktree 即成为该会话的工作区）；
 * - 删除：confirmDialog 二次确认；脏树后端拒绝时由用户 force 重试（表单
 *   内不自动 force —— 丢改动必须显式确认）。
 * - 「改动被困」告警保留（stranded）。
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { AlertTriangle, GitBranch, Plus, Trash2 } from 'lucide-react';
import { Badge, Card, Icon } from '@/features/design-system';
import { confirmDialog } from '@/logic/modals/confirm';
import { CURRENT_WORKSPACE_QUERY_KEY } from '@/logic/shell/useCurrentWorkspace';
import { useI18n } from '@/utils/i18n';
import { useAgentStore } from '@/stores/agentStore';
import {
  zhuye_create_worktree,
  zhuye_list_worktrees,
  zhuye_remove_worktree,
} from '@/utils/commands/git';
import { zhuye_set_workspace } from '@/utils/commands/workspaces';
import s from '@/render/git/GitView.module.css';

export function WorktreePanel() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ['git-worktrees'],
    queryFn: () => zhuye_list_worktrees(),
    staleTime: 15_000,
  });
  const worktrees = q.data ?? [];
  const stranded = worktrees.filter((w) => w.stranded);

  const toast = (message: string, kind: 'success' | 'error' = 'success') => {
    useAgentStore.getState().pushToast({ kind, message });
  };
  const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

  // ===== 新建表单 =====
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [branch, setBranch] = useState('');
  const createMut = useMutation({
    mutationFn: () => zhuye_create_worktree(name.trim(), branch.trim() === '' ? undefined : branch.trim()),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: ['git-worktrees'] });
      setName('');
      setBranch('');
      setFormOpen(false);
      toast(t('git.worktrees.created', { name: created.branch || created.path }));
    },
    onError: (e) => toast(t('git.worktrees.createFailed', { msg: errMsg(e) }), 'error'),
  });

  // ===== 删除（脏树由用户在确认框知情后 force）=====
  const removeMut = useMutation({
    mutationFn: ({ path, force }: { path: string; force: boolean }) => zhuye_remove_worktree(path, force),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['git-worktrees'] });
      toast(t('git.worktrees.removed'));
    },
    onError: (e) => toast(t('git.worktrees.removeFailed', { msg: errMsg(e) }), 'error'),
  });

  const remove = async (path: string, dirty: boolean) => {
    const label = path.split('/').filter(Boolean).pop() ?? path;
    const message = dirty
      ? t('git.worktrees.removeConfirmDirty', { name: label })
      : t('git.worktrees.removeConfirm', { name: label });
    const ok = await confirmDialog({
      title: t('git.worktrees.remove'),
      message,
      confirmLabel: t('git.worktrees.remove'),
    });
    if (!ok) return;
    removeMut.mutate({ path, force: dirty });
  };

  // ===== 在此开会话（切 workspace → 导航新对话首页）=====
  const [opening, setOpening] = useState(false);
  const openSession = async (path: string) => {
    if (opening) return;
    setOpening(true);
    try {
      await zhuye_set_workspace(path);
      void qc.invalidateQueries({ queryKey: ['agent-status'] });
      void qc.invalidateQueries({ queryKey: ['workspaces'] });
      void qc.invalidateQueries({ queryKey: CURRENT_WORKSPACE_QUERY_KEY });
      void qc.invalidateQueries({ queryKey: ['git-worktrees'] });
      // 不预创建会话:首条消息发出时才落盘,侧栏届时随列表刷新出现。
      navigate({ to: '/chat' });
    } catch (e) {
      toast(t('git.worktrees.sessionFailed', { msg: errMsg(e) }), 'error');
    } finally {
      setOpening(false);
    }
  };

  // 非 repo / 无 worktree 且未展开创建表单 → 不占版面。
  if (worktrees.length === 0 && !q.isLoading && !formOpen) return null;

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
        <button
          type="button"
          className={s.worktreeAddBtn}
          onClick={() => setFormOpen((v) => !v)}
          data-testid="git-worktree-toggle-form"
        >
          <Icon icon={Plus} size={12} /> {t('git.worktrees.create')}
        </button>
      </div>
      {stranded.length > 0 && (
        <p className={s.worktreeWarn} data-testid="git-worktree-stranded">
          <Icon icon={AlertTriangle} size={12} /> {t('git.worktrees.strandedHint')}
        </p>
      )}
      {formOpen && (
        <form
          className={s.worktreeForm}
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) createMut.mutate(); }}
          data-testid="git-worktree-form"
        >
          <input
            className={s.worktreeInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('git.worktrees.namePlaceholder')}
            data-testid="git-worktree-name"
          />
          <input
            className={s.worktreeInput}
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder={t('git.worktrees.branchPlaceholder')}
            data-testid="git-worktree-branch"
          />
          <button type="submit" className={s.worktreeBtn} disabled={!name.trim() || createMut.isPending} data-testid="git-worktree-create">
            {t('git.worktrees.createBtn')}
          </button>
        </form>
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
            {w.isolated && (
              <span className={s.worktreeActions}>
                <button
                  type="button"
                  className={s.worktreeBtn}
                  disabled={opening}
                  onClick={() => void openSession(w.path)}
                  data-testid={`git-worktree-open-${w.branch || 'detached'}`}
                >
                  {t('git.worktrees.openSession')}
                </button>
                <button
                  type="button"
                  className={`${s.worktreeBtn} ${s.worktreeBtnDanger}`}
                  disabled={removeMut.isPending}
                  onClick={() => void remove(w.path, w.dirty)}
                  data-testid={`git-worktree-remove-${w.branch || 'detached'}`}
                >
                  <Icon icon={Trash2} size={11} /> {t('git.worktrees.remove')}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
