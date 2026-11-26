import { Zap, Clock, History } from 'lucide-react';
import type { AutopilotViewProps } from '@/contracts/orchestration/autopilot';
import { PageShell } from '@/render/harness/shell/PageShell';
import { Card } from '@/render/harness/design-system/Card';
import { Badge } from '@/render/harness/design-system/Badge';
import { Icon } from '@/render/harness/design-system/Icon';
import { Button } from '@/render/harness/design-system/Button';
import { EmptyState } from '@/render/harness/design-system/EmptyState';
import { Spinner } from '@/render/harness/design-system/Spinner';
import { Input } from '@/render/harness/design-system/Input';
import { Select } from '@/render/harness/design-system/Select';
import s from './AutopilotView.module.css';

export function AutopilotView({ t, config, isEditing, configLoading, configError, agents, history,
  historyLoading, historyError, updating, updateError, onUpdate, onEdit, onCancel, onSave }: AutopilotViewProps) {
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
      {configLoading ? (
        <Spinner size={20} />
      ) : configError ? (
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
                  onChange={(e) => onUpdate('enabled', e.target.checked)}
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
                onChange={(e) => onUpdate('schedule', e.target.value)}
                disabled={!isEditing}
              />
            </div>

            <div className={s.formRow}>
              <label className={s.fieldLabel}>{t('autopilot.taskTemplate')}</label>
              <textarea
                className={s.textarea}
                placeholder={t('autopilot.taskTemplatePlaceholder')}
                value={config.taskTemplate}
                onChange={(e) => onUpdate('taskTemplate', e.target.value)}
                disabled={!isEditing}
                rows={4}
              />
            </div>

            <div className={s.formRow}>
              <label className={s.fieldLabel}>{t('autopilot.agent')}</label>
              <Select
                aria-label={t('autopilot.agent')}
                value={config.agent ?? ''}
                onChange={(e) => onUpdate('agent', e.target.value || null)}
                disabled={!isEditing}
              >
                <option value="">{t('autopilot.agentDefault')}</option>
                {agents.map((agent) => (
                  <option key={agent} value={agent}>{agent}</option>
                ))}
              </Select>
            </div>

            <div className={s.formRow}>
              <label className={s.fieldLabel}>{t('autopilot.maxConcurrent')}</label>
              <Input
                type="number"
                aria-label={t('autopilot.maxConcurrent')}
                value={config.maxConcurrent}
                onChange={(e) => onUpdate('maxConcurrent', parseInt(e.target.value) || 1)}
                disabled={!isEditing}
              />
            </div>

            <div className={s.actions}>
              {isEditing ? (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={onSave}
                    disabled={updating}
                  >
                    {t('common.save')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={onCancel}>
                    {t('common.cancel')}
                  </Button>
                </>
              ) : (
                <Button variant="ghost" size="sm" onClick={onEdit}>
                  {t('autopilot.edit')}
                </Button>
              )}
            </div>
            {updateError && <p role="alert">{t('autopilot.saveFailed')}</p>}
          </Card>

          {/* History card */}
          <Card level="flat" padding="lg" className={s.historyCard}>
            <div className={s.configHeader}>
              <div className={s.configTitle}>
                <Icon icon={History} size={18} />
                <span>{t('autopilot.runHistory')}</span>
              </div>
              {history && history.length > 0 && (
                <Badge variant="neutral">{history.length}</Badge>
              )}
            </div>

            {historyLoading ? (
              <Spinner size={16} />
            ) : historyError ? (
              <p role="alert">{t('autopilot.historyLoadFailed')}</p>
            ) : history?.length === 0 ? (
              <EmptyState
                icon={<Icon icon={Clock} />}
                title={t('autopilot.noRuns')}
                description={t('autopilot.noRunsDesc')}
              />
            ) : (
              <div className={s.historyList}>
                {history?.map((run) => (
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
