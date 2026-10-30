/**
 * Workspaces —— 项目工作区管理 (B9-04 升级 + 项目目录直通)。
 *
 * - 顶部当前 workspace + 「打开项目目录…」（原生目录选择框 → set）。
 * - 「最近项目」列表来自 `~/.zhuye/workspaces.json`（每次切换自动记录），
 *   按 last_used 倒序；active 用 success badge 标出，可一键切回。
 * - 每张卡可「在文件管理器中显示」（Finder / 资源管理器 / xdg-open）。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, CheckCircle2, ArrowRight, FolderSearch, FileSearch } from 'lucide-react';
import {
  reflect_agent_status,
  reflect_list_workspaces,
  reflect_set_workspace,
  reflect_pick_workspace_folder,
  reflect_reveal_path,
} from '@/utils/commands';
import { PageShell } from '@/features/shell/PageShell';
import { Card, Badge, Icon, Spinner, EmptyState, Button } from '@/features/design-system';
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

  const onUse = async (path: string) => {
    try {
      await reflect_set_workspace(path);
      pushToast({ kind: 'success', message: t('workspaces.setTo', { name: basename(path) }) });
      refreshAll();
    } catch (e) {
      pushToast({
        kind: 'error',
        message: t('workspaces.switchFailed', { msg: errMsg(e) }),
      });
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

  const workspaces = workspacesQ.data ?? [];

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
                </div>
              </Card>
            );
          })}
        </div>
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
