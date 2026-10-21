/**
 * HooksView —— Hook 管理（P3：命令早已有，此前无任何 UI 消费）。
 *
 * 列出后端 HookRegistry 的全部 hook（内置 read_before_edit /
 * plan_mode_gate / 用户自定义），支持逐条启用/禁用（`reflect_toggle_hook`，
 * 后端即时生效）与刷新。新增/编辑自定义 hook 仍走 Settings → Provider 的
 * ConfigForm（`[hooks]` TOML 段）—— 这里只做运行时启停面板。
 */
import { useCallback, useEffect, useState } from 'react';
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

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    reflect_list_hooks()
      .then((list) => setHooks(list))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggle = async (hook: ReflectHookInfo) => {
    if (pendingName) return;
    setPendingName(hook.name);
    try {
      await reflect_toggle_hook(hook.name, !hook.enabled);
      setHooks((prev) => prev.map((h) => (h.name === hook.name ? { ...h, enabled: !h.enabled } : h)));
    } catch (e) {
      pushToast({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setPendingName(null);
    }
  };

  return (
    <PageShell icon={Webhook} title={t('hooks.title')} subtitle={t('hooks.subtitle')} width="lg">
      <div className={s.toolbar}>
        <span className={s.summary}>
          {t('hooks.enabledCount', { enabled: hooks.filter((h) => h.enabled).length, total: hooks.length })}
        </span>
        <Button size="sm" variant="secondary" onClick={refresh} disabled={loading} leftIcon={<Icon icon={RefreshCw} size={13} />} data-testid="hooks-refresh">
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
                    disabled={pendingName === hook.name}
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
