/**
 * Autopilot 配置和历史视图；后台驱动按 cron 提交任务并回填历史。
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Zap, Clock, History } from 'lucide-react';
import { PageShell } from '@/features/shell/PageShell';
import { Card, Badge, Icon, Button, EmptyState, Spinner, Input, Select } from '@/features/design-system';
import {
  reflect_get_autopilot_config,
  reflect_update_autopilot_config,
  reflect_autopilot_history,
  reflect_list_agent_defs,
  type ReflectAutopilotConfig,
} from '@/utils/commands';
import { useI18n } from '@/utils/i18n';
import { useState } from 'react';
import s from './AutopilotView.module.css';

const DEFAULT_CONFIG: ReflectAutopilotConfig = {
  enabled: false,
  schedule: '',
  taskTemplate: '',
  agent: null,
  maxConcurrent: 1,
};

export function AutopilotView() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [draft, setDraft] = useState<ReflectAutopilotConfig | null>(null);

  const configQuery = useQuery({
    queryKey: ['autopilot', 'config'],
    queryFn: reflect_get_autopilot_config,
  });

  const historyQuery = useQuery({
    queryKey: ['autopilot', 'history'],
    queryFn: reflect_autopilot_history,
    refetchInterval: 5_000,
  });

  const agentsQuery = useQuery({
    queryKey: ['agents', 'list'],
    queryFn: reflect_list_agent_defs,
    staleTime: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: (cfg: ReflectAutopilotConfig) => reflect_update_autopilot_config(cfg),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['autopilot', 'config'] });
      setDraft(null);
    },
  });

  const config = draft ?? configQuery.data ?? DEFAULT_CONFIG;
  const isEditing = draft !== null;

  function update<K extends keyof ReflectAutopilotConfig>(key: K, value: ReflectAutopilotConfig[K]) {
    setDraft({ ...config, ...draft, [key]: value });
  }

  return (
    <PageShell
      icon={Zap}
      title={t('autopilot.title')}
      subtitle={t('autopilot.subtitle')}
      width="md"
    >
      <Card level="outlined" padding="md">
        <p role="status">{t('autopilot.executionStatus')}</p>
      </Card>
      {configQuery.isLoading ? (
        <Spinner size={20} />
      ) : configQuery.isError ? (
        <p role="alert">{t('autopilot.configLoadFailed')}</p>
      ) : (
        <>
          {/* Config card */}
          <Card level="flat" padding="lg" className={s.configCard}>
            <div className={s.configHeader}>
              <div className={s.configTitle}>
                <Icon icon={Zap} size={18} />
                <span>{t('autopilot.configuration')}</span>
              </div>
              <Badge variant={config.enabled ? 'success' : 'neutral'}>
                {config.enabled ? t('autopilot.enabled') : t('autopilot.disabled')}
              </Badge>
            </div>

            <div className={s.formRow}>
              <label className={s.label}>
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(e) => update('enabled', e.target.checked)}
                  disabled={!isEditing}
                />
                <span>{t('autopilot.enable')}</span>
              </label>
            </div>

            <div className={s.formRow}>
              <label className={s.fieldLabel}>{t('autopilot.cronSchedule')}</label>
              <Input
                placeholder={t('autopilot.cronPlaceholder')}
                value={config.schedule}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => update('schedule', e.target.value)}
                disabled={!isEditing}
              />
            </div>

            <div className={s.formRow}>
              <label className={s.fieldLabel}>{t('autopilot.taskTemplate')}</label>
              <textarea
                className={s.textarea}
                placeholder={t('autopilot.taskTemplatePlaceholder')}
                value={config.taskTemplate}
                onChange={(e) => update('taskTemplate', e.target.value)}
                disabled={!isEditing}
                rows={4}
              />
            </div>

            <div className={s.formRow}>
              <label className={s.fieldLabel}>{t('autopilot.agent')}</label>
              <Select
                aria-label={t('autopilot.agent')}
                value={config.agent ?? ''}
                onChange={(e) => update('agent', e.target.value || null)}
                disabled={!isEditing}
              >
                <option value="">{t('autopilot.agentDefault')}</option>
                {(agentsQuery.data ?? []).map((agent) => (
                  <option key={agent.name} value={agent.name}>{agent.name}</option>
                ))}
              </Select>
            </div>

            <div className={s.formRow}>
              <label className={s.fieldLabel}>{t('autopilot.maxConcurrent')}</label>
              <Input
                type="number"
                aria-label={t('autopilot.maxConcurrent')}
                value={config.maxConcurrent}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => update('maxConcurrent', parseInt(e.target.value) || 1)}
                disabled={!isEditing}
              />
            </div>

            <div className={s.actions}>
              {isEditing ? (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => updateMutation.mutate(draft!)}
                    disabled={updateMutation.isPending}
                  >
                    {t('common.save')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                    {t('common.cancel')}
                  </Button>
                </>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setDraft(config)}>
                  {t('autopilot.edit')}
                </Button>
              )}
            </div>
            {updateMutation.isError && <p role="alert">{t('autopilot.saveFailed')}</p>}
          </Card>

          {/* History card */}
          <Card level="flat" padding="lg" className={s.historyCard}>
            <div className={s.configHeader}>
              <div className={s.configTitle}>
                <Icon icon={History} size={18} />
                <span>{t('autopilot.runHistory')}</span>
              </div>
              {historyQuery.data && historyQuery.data.length > 0 && (
                <Badge variant="neutral">{historyQuery.data.length}</Badge>
              )}
            </div>

            {historyQuery.isLoading ? (
              <Spinner size={16} />
            ) : historyQuery.isError ? (
              <p role="alert">{t('autopilot.historyLoadFailed')}</p>
            ) : historyQuery.data?.length === 0 ? (
              <EmptyState
                icon={<Icon icon={Clock} />}
                title={t('autopilot.noRuns')}
                description={t('autopilot.noRunsDesc')}
              />
            ) : (
              <div className={s.historyList}>
                {historyQuery.data?.map((run) => (
                  <div key={run.id} className={s.historyItem}>
                    <div className={s.historyMeta}>
                      <Badge
                        variant={
                          run.status === 'success' ? 'success'
                          : run.status === 'failed' ? 'danger'
                          : run.status === 'inProgress' ? 'info'
                          : 'neutral'
                        }
                      >
                        {run.status}
                      </Badge>
                      <span className={s.historyTime}>
                        {new Date(run.executedAtMs).toLocaleString()}
                      </span>
                    </div>
                    {run.error && <span className={s.historyError}>{run.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </PageShell>
  );
}
