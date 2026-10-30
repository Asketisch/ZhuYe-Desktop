/**
 * HooksView —— Hook 管理（P3：命令早已有，此前无任何 UI 消费）。
 *
 * 列出运行中引擎已注册的 hook，支持启用、禁用和刷新。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Webhook, RefreshCw } from 'lucide-react';
import { PageShell } from '@/features/shell/PageShell';
import { Card, Badge, Icon, Spinner, EmptyState, Button } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { useAgentStore } from '@/stores/agentStore';
import { reflect_list_hooks, reflect_toggle_hook, type ReflectHookInfo } from '@/utils/commands';
import s from './HooksView.module.css';

import { HookEventsPanel } from './HookEventsPanel';

export function HooksView() {
  const { t } = useI18n();
  const pushToast = useAgentStore((st) => st.pushToast);
  const [hooks, setHooks] = useState<ReflectHookInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const pending = useRef(false);
  const refreshRevision = useRef(0);

  const refresh = useCallback(() => {
    const revision = ++refreshRevision.current;
    setLoading(true);
    setError(null);
    reflect_list_hooks()
      .then((list) => { if (refreshRevision.current === revision) setHooks(list); })
      .catch((e: unknown) => { if (refreshRevision.current === revision) setError(errorMessage(e)); })
      .finally(() => { if (refreshRevision.current === revision) setLoading(false); });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggle = async (hook: ReflectHookInfo) => {
    if (pending.current) return;
    pending.current = true;
    setPendingName(hook.name);
    try {
      await reflect_toggle_hook(hook.name, !hook.enabled);
      refresh();
    } catch (e) {
      pushToast({ kind: 'error', message: errorMessage(e) });
    } finally {
      setPendingName(null);
      pending.current = false;
    }
  };

  return (
    <PageShell icon={Webhook} title={t('hooks.title')} subtitle={t('hooks.subtitle')} width="lg">
      <div className={s.toolbar}>
        <span className={s.summary}>
          {t('hooks.enabledCount', { enabled: hooks.filter((h) => h.enabled).length, total: hooks.length })}
        </span>
        <Button size="sm" variant="secondary" onClick={refresh} disabled={loading || pendingName !== null} leftIcon={<Icon icon={RefreshCw} size={13} />} data-testid="hooks-refresh">
          {t('git.refresh')}
        </Button>
      </div>

      {loading && (
        <Card level="flat" padding="lg">
          <div className={s.center}><Spinner size={14} /> {t('common.loading')}</div>
        </Card>
      )}

      {!loading && error && (
        <Card level="flat" padding="lg">
          <EmptyState icon={<Icon icon={Webhook} size={20} />} title={t('hooks.loadFailed')} description={error} />
        </Card>
      )}

      {!loading && !error && hooks.length === 0 && (
        <Card level="flat" padding="lg">
          <EmptyState icon={<Icon icon={Webhook} size={20} />} title={t('hooks.empty')} description={t('hooks.emptyDesc')} />
        </Card>
      )}

      {!loading && hooks.length > 0 && (
        <Card level="flat" padding="none">
          <ul className={s.list}>
            {hooks.map((hook) => (
              <li key={hook.name} className={s.row} data-testid={`hook-row-${hook.name}`}>
                <div className={s.main}>
                  <div className={s.titleRow}>
                    <code className={s.name}>{hook.name}</code>
                    <Badge variant={hook.kind === 'custom' ? 'info' : 'neutral'}>{hook.kind}</Badge>
                    {hook.enabled ? <Badge variant="success">{t('hooks.on')}</Badge> : <Badge variant="neutral">{t('hooks.off')}</Badge>}
                  </div>
                  <p className={s.summary}>{hook.config_summary}</p>
                </div>
                <label className={s.toggleLabel}>
                  <input
                    type="checkbox"
                    checked={hook.enabled}
                    disabled={pendingName !== null}
                    onChange={() => void toggle(hook)}
                    aria-label={`${hook.enabled ? t('hooks.disable') : t('hooks.enable')}: ${hook.name}`}
                    data-testid={`hook-toggle-${hook.name}`}
                  />
                </label>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* 可挂载的事件类型 —— 用户此前不知道 hook 能在哪些时机触发、能做什么决策。 */}
      <HookEventsPanel />
    </PageShell>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'msg' in error && typeof error.msg === 'string') return error.msg;
  return String(error);
}
