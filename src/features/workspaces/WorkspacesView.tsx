/**
 * Workspaces —— 项目工作区管理 (B9-04 升级 + 项目目录直通)。
 *
 * - 顶部当前 workspace + 「打开项目目录…」（原生目录选择框 → set）。
 * - 「最近项目」列表来自 `~/.zhuye/workspaces.json`（每次切换自动记录），
 *   按 last_used 倒序；active 用 success badge 标出，可一键切回。
 * - 每张卡可「在文件管理器中显示」（Finder / 资源管理器 / xdg-open）。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FolderOpen, CheckCircle2, ArrowRight, FolderSearch, FileSearch, FolderPlus, RotateCcw, Trash2, X } from 'lucide-react';
import {
  reflect_agent_status,
  reflect_current_workspace_dirs,
  reflect_list_workspaces,
  reflect_pick_workspace_folder,
  reflect_remove_workspace,
  reflect_reveal_path,
  reflect_set_workspace,
  reflect_set_workspace_dirs,
} from '@/utils/commands';
import { PageShell } from '@/features/shell/PageShell';
import { Card, Badge, Icon, Spinner, EmptyState, Button } from '@/features/design-system';
import { confirmDialog } from '@/features/modals/ConfirmDialog';
import { useI18n } from '@/utils/i18n';
import { relativeTime } from '@/utils/time';
import { useAgentStore } from '@/stores/agentStore';
import { CURRENT_WORKSPACE_QUERY_KEY } from '@/features/shell/hooks/useCurrentWorkspace';
import { SESSIONS_QUERY_KEY } from '@/features/sessions/hooks/useSessions';
import s from './WorkspacesView.module.css';

/** `last_used` 是 unix 秒（Rust u64）；转 ISO 供 relativeTime 显示。 */
function lastUsedIso(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

export function WorkspacesView() {
  const { t, tp } = useI18n();
  const qc = useQueryClient();
  const pushToast = useAgentStore((st) => st.pushToast);
  const statusQ = useQuery({
    queryKey: ['agent-status'],
    queryFn: reflect_agent_status,
    staleTime: 30_000,
  });
  const workspacesQ = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => reflect_list_workspaces(),
    staleTime: 30_000,
  });

  const currentWs = statusQ.data?.workspace;

  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ['agent-status'] });
    void qc.invalidateQueries({ queryKey: ['workspaces'] });
    // workspace 切换后:当前 workspace 缓存 + session 列表(按 workspace
    // 过滤)都要失效,否则 Sidebar / `@` 弹层拿到的是切换前的数据。
    void qc.invalidateQueries({ queryKey: CURRENT_WORKSPACE_QUERY_KEY });
    void qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
  };

  // 管理页的「使用 / 恢复」都是显式动作 → unhide,已移除的条目随之恢复显示。
  const onUse = async (path: string) => {
    try {
      await reflect_set_workspace(path, true);
      pushToast({ kind: 'success', message: t('workspaces.setTo', { name: basename(path) }) });
      refreshAll();
    } catch (e) {
      pushToast({
        kind: 'error',
        message: t('workspaces.switchFailed', { msg: errMsg(e) }),
      });
    }
  };

  // v1.x 修复:移除(软删除)入口补到管理页 —— 此前只有侧边栏组头有;
  // 且后端按规范化路径匹配所有变体,不会再出现「删了又回来」。
  const onRemove = async (path: string) => {
    if (!await confirmDialog({
      title: t('sidebar.group.remove'),
      message: t('sidebar.group.removeConfirm'),
    })) return;
    try {
      await reflect_remove_workspace(path);
      pushToast({ kind: 'success', message: t('workspaces.removedToast', { name: basename(path) }) });
      refreshAll();
    } catch (e) {
      pushToast({ kind: 'error', message: t('workspaces.removeFailed', { msg: errMsg(e) }) });
    }
  };

  const onPickFolder = async () => {
    let picked: string | null;
    try {
      picked = await reflect_pick_workspace_folder();
    } catch (e) {
      pushToast({ kind: 'error', message: t('workspaces.pickFailed', { msg: errMsg(e) }) });
      return;
    }
    if (picked) await onUse(picked);
  };

  const onReveal = async (path: string) => {
    try {
      await reflect_reveal_path(path);
    } catch (e) {
      pushToast({ kind: 'error', message: t('workspaces.revealFailed', { msg: errMsg(e) }) });
    }
  };

  const workspaces = (workspacesQ.data ?? []).filter((workspace) => !workspace.hidden);
  const removed = (workspacesQ.data ?? []).filter((workspace) => workspace.hidden);

  return (
    <PageShell
      icon={FolderOpen}
      title={t('workspaces.title')}
      subtitle={t('workspaces.subtitle')}
      width="md"
    >
      <Card level="outlined" padding="md" className={s.currentCard}>
        <div className={s.currentRow}>
          <Icon icon={CheckCircle2} size={14} />
          <span className={s.currentLabel}>{t('workspaces.current')}</span>
          <code className={s.currentPath} data-testid="workspaces-current">
            {currentWs ?? t('common.loading')}
          </code>
        </div>
        <div className={s.currentActions}>
          <Button
            size="sm"
            variant="primary"
            leftIcon={<Icon icon={FolderSearch} size={14} />}
            onClick={() => void onPickFolder()}
            data-testid="workspaces-open-folder"
          >
            {t('workspaces.openFolder')}
          </Button>
          {currentWs && (
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<Icon icon={FileSearch} size={14} />}
              onClick={() => void onReveal(currentWs)}
              data-testid="workspaces-reveal-current"
            >
              {t('workspaces.reveal')}
            </Button>
          )}
        </div>
        {/* v1.11 桌面#5:多目录综合 —— 附加目录编辑(合成一个项目)。 */}
        <AdditionalDirsEditor />
        <p className={s.note}>
          {t('workspaces.note')}
        </p>
      </Card>

      <h3 className={s.sectionTitle}>{t('workspaces.recent')}</h3>
      {workspacesQ.isLoading ? (
        <div className={s.loading}><Spinner size={20} /></div>
      ) : workspacesQ.isError ? (
        <Card level="flat" padding="none">
          <EmptyState
            icon={<Icon icon={FolderOpen} />}
            title={t('workspaces.loadFailed')}
            description={errMsg(workspacesQ.error)}
          />
        </Card>
      ) : workspaces.length === 0 ? (
        <Card level="flat" padding="none">
          <EmptyState
            icon={<Icon icon={FolderOpen} />}
            title={t('workspaces.empty')}
            description={t('workspaces.emptyDesc')}
          />
        </Card>
      ) : (
        <div className={s.list} data-testid="workspaces-list">
          {workspaces.map((w) => {
            const isActive = w.path === currentWs;
            return (
              <Card
                key={w.path}
                level="outlined"
                padding="sm"
                className={s.wsCard}
                data-active={isActive || undefined}
                data-testid={`workspace-card-${basename(w.path)}`}
              >
                <div className={s.wsIcon}>
                  <Icon icon={FolderOpen} size={16} />
                </div>
                <div className={s.wsBody}>
                  <div className={s.wsNameRow}>
                    <span className={s.wsName}>{w.label || basename(w.path)}</span>
                    {isActive && <Badge variant="success" dot>{t('home.active')}</Badge>}
                  </div>
                  <div className={s.wsMeta}>
                    <code className={s.wsPath}>{w.path}</code>
                    <span className={s.wsSep}>·</span>
                    <span>
                      {tp('workspaces.sessionCount', w.session_count, { count: w.session_count })}
                    </span>
                    <span className={s.wsSep}>·</span>
                    <span title={lastUsedIso(w.last_used)}>
                      {t('workspaces.lastUsed', { time: relativeTime(lastUsedIso(w.last_used)) })}
                    </span>
                  </div>
                </div>
                <div className={s.wsActions}>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void onReveal(w.path)}
                    aria-label={t('workspaces.reveal')}
                    data-testid={`workspace-reveal-${basename(w.path)}`}
                  >
                    <Icon icon={FileSearch} size={12} />
                  </Button>
                  {!isActive && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void onUse(w.path)}
                      data-testid={`workspace-use-${basename(w.path)}`}
                    >
                      {t('workspaces.use')} <Icon icon={ArrowRight} size={12} />
                    </Button>
                  )}
                  {!isActive && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void onRemove(w.path)}
                      aria-label={t('workspaces.remove')}
                      data-testid={`workspace-remove-${basename(w.path)}`}
                    >
                      <Icon icon={Trash2} size={12} />
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* v1.x 修复:已移除(软删除)工作区在此集中恢复 —— 常规切换不再
          自动复活它们,唯一的恢复入口是这里的「恢复」按钮。 */}
      {removed.length > 0 && (
        <>
          <h3 className={s.sectionTitle}>{t('workspaces.removedTitle')}</h3>
          <div className={s.list} data-testid="workspaces-removed-list">
            {removed.map((w) => (
              <Card
                key={w.path}
                level="outlined"
                padding="sm"
                className={s.wsCard}
                data-testid={`workspace-removed-${basename(w.path)}`}
              >
                <div className={s.wsIcon}>
                  <Icon icon={FolderOpen} size={16} />
                </div>
                <div className={s.wsBody}>
                  <div className={s.wsNameRow}>
                    <span className={s.wsName}>{w.label || basename(w.path)}</span>
                  </div>
                  <div className={s.wsMeta}>
                    <code className={s.wsPath}>{w.path}</code>
                  </div>
                </div>
                <div className={s.wsActions}>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void onUse(w.path)}
                    data-testid={`workspace-restore-${basename(w.path)}`}
                  >
                    <Icon icon={RotateCcw} size={12} /> {t('workspaces.restore')}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </PageShell>
  );
}

function basename(p: string): string {
  const parts = p.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || p;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * v1.11 桌面#5:附加目录编辑器 —— 把多个目录合成一个项目。
 *
 * 主工作区仍是规范根(memory / skills / rollout 相对它);附加目录拼进
 * 引擎的 sandbox_writable,文件类工具对其放行读写。保存走
 * `reflect_set_workspace_dirs`(主 + 附加全量覆盖;新绑定会话生效)。
 */
function AdditionalDirsEditor() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const pushToast = useAgentStore((st) => st.pushToast);
  const [adding, setAdding] = useState(false);
  const dirsQ = useQuery({
    queryKey: ['workspace-dirs'],
    queryFn: reflect_current_workspace_dirs,
    staleTime: 10_000,
  });

  const pickAndAdd = async () => {
    let picked: string | null = null;
    try {
      picked = await reflect_pick_workspace_folder();
    } catch (e) {
      pushToast({ kind: 'error', message: t('workspaces.pickFailed', { msg: errMsg(e) }) });
      return;
    }
    if (!picked) return;
    const current = dirsQ.data ?? { main: '', additional: [] };
    if (current.additional.includes(picked) || picked === current.main) return;
    try {
      await reflect_set_workspace_dirs(current.main, [...current.additional, picked]);
      pushToast({ kind: 'success', message: t('workspaces.additionalAdded') });
      void qc.invalidateQueries({ queryKey: ['workspace-dirs'] });
    } catch (e) {
      pushToast({
        kind: 'error',
        message: t('workspaces.additionalFailed', { msg: errMsg(e) }),
      });
    }
    setAdding(false);
  };

  const removeDir = async (dir: string) => {
    const current = dirsQ.data ?? { main: '', additional: [] };
    try {
      await reflect_set_workspace_dirs(
        current.main,
        current.additional.filter((d) => d !== dir),
      );
      void qc.invalidateQueries({ queryKey: ['workspace-dirs'] });
    } catch (e) {
      pushToast({
        kind: 'error',
        message: t('workspaces.additionalFailed', { msg: errMsg(e) }),
      });
    }
  };

  const additional = dirsQ.data?.additional ?? [];

  return (
    <div className={s.additionalDirs} data-testid="workspace-additional-dirs">
      <div className={s.currentRow}>
        <Icon icon={FolderPlus} size={14} />
        <span className={s.currentLabel}>{t('workspaces.additionalDirs')}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setAdding(true);
            void pickAndAdd();
          }}
          data-testid="workspaces-additional-add"
        >
          {t('workspaces.additionalAdd')}
        </Button>
      </div>
      {adding && <p className={s.note}>{t('workspaces.additionalPicking')}</p>}
      {additional.length > 0 ? (
        <ul className={s.additionalList}>
          {additional.map((dir) => (
            <li key={dir} className={s.additionalRow} data-testid={`workspace-additional-${basename(dir)}`}>
              <code className={s.wsPath}>{dir}</code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void removeDir(dir)}
                aria-label={t('workspaces.additionalRemove')}
                data-testid={`workspace-additional-remove-${basename(dir)}`}
              >
                <Icon icon={X} size={12} />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={s.note}>{t('workspaces.additionalEmpty')}</p>
      )}
    </div>
  );
}
