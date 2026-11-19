/**
 * Models —— 当前模型卡片、coding plan 切换与 reasoning effort 控件。
 */
import { Cpu, Folder, AlertTriangle, CheckCircle2, Zap } from 'lucide-react';
import type { ModelsViewProps } from '@/contracts/models';
import { Card } from '../design-system/Card';
import { Badge } from '../design-system/Badge';
import { Button } from '../design-system/Button';
import { Icon } from '../design-system/Icon';
import { EmptyState } from '../design-system/EmptyState';
import { SegmentedControl } from '../design-system/SegmentedControl';
import s from './ModelsView.module.css';

export function ModelsView({ t, loading, hasModel, model, workspace, degradedReason, plans,
  effort, effortOptions, effortAdjusted, effortEffective, saved, onGoSettings, onSwitchPlan,
  onEffortChange, onApplyEffort }: ModelsViewProps) {
  return (
    <div className={s.root}>
      <header className={s.header}>
        <h1 className={s.title}>{t('models.title')}</h1>
        <p className={s.subtitle}>{t('models.subtitle')}</p>
      </header>

      <section>
        <h2 className={s.sectionTitle}>{t('models.currentModel')}</h2>
        {loading ? (
          <Card level="outlined" padding="md"><p className={s.loading}>{t('common.loading')}</p></Card>
        ) : hasModel ? (
          <Card level="outlined" padding="lg" className={s.modelCard}>
            <div className={s.modelIcon}><Icon icon={Cpu} size={24} /></div>
            <div className={s.modelBody}>
              <div className={s.modelNameRow}>
                <code className={s.modelName}>{model}</code>
                <Badge variant="success" dot>{t('about.ready')}</Badge>
              </div>
              {workspace && (
                <div className={s.workspaceRow}>
                  <Icon icon={Folder} size={12} />
                  <code className={s.workspace}>{workspace}</code>
                </div>
              )}
            </div>
          </Card>
        ) : (
          <Card level="outlined" padding="lg">
            <EmptyState
              icon={<Icon icon={AlertTriangle} />}
              title={t('models.noProvider')}
              description={<>{degradedReason ?? t('models.noProviderDesc')} {t('models.configureHint')}</>}
              action={<Button variant="primary" size="sm" onClick={onGoSettings}>{t('palette.item.goSettings')}</Button>}
            />
          </Card>
        )}
      </section>

      <section>
        <h2 className={s.sectionTitle}>{t('models.plans')}</h2>
        {plans.length === 0 ? (
          <Card level="outlined" padding="lg"><p className={s.loading}>{t('models.plansEmpty')}</p></Card>
        ) : (
          <div className={s.planList}>
            {plans.map((plan) => (
              <Card key={`${plan.provider}/${plan.label}`} level="outlined" padding="md" className={s.planCard}>
                <div className={s.planMain}>
                  <div className={s.planTitleRow}>
                    <code className={s.planLabel}>{plan.label}</code>
                    <Badge variant={plan.isDefault ? 'success' : 'info'}>{plan.provider}</Badge>
                    {plan.quota?.checkVia && <Badge variant="warning"><Icon icon={Zap} size={10} /> {plan.quota.checkVia}</Badge>}
                  </div>
                  <div className={s.planMetaRow}>
                    <span>{plan.apiKey}</span>
                    {plan.model && <span>{plan.model}</span>}
                    {plan.baseUrl && <span>{plan.baseUrl}</span>}
                  </div>
                </div>
                <Button variant={plan.isDefault ? 'ghost' : 'primary'} size="sm"
                  disabled={plan.isDefault || plan.switching}
                  loading={plan.switching}
                  onClick={() => onSwitchPlan(plan)}>
                  {plan.isDefault ? t('models.planIsDefault') : t('models.planSetDefault')}
                </Button>
              </Card>
            ))}
          </div>
        )}
        <p className={s.note}>{t('models.plansHint')}</p>
      </section>

      <section>
        <h2 className={s.sectionTitle}>{t('models.effort')}</h2>
        <Card level="outlined" padding="lg">
          <div className={s.effortHeader}>
            <div className={s.effortLabel}>
              <Icon icon={Zap} size={14} />
              <span>{t('models.effortHint')}</span>
            </div>
            <SegmentedControl value={effort} onChange={onEffortChange} options={effortOptions} stacked />
          </div>
          <div className={s.effortApply}>
            <Button variant="primary" onClick={onApplyEffort} leftIcon={<Icon icon={CheckCircle2} size={14} />}>
              {saved ? t('models.applied') : t('models.applyEffort')}
            </Button>
            <span className={s.effortHint}>{effortOptions.find((o) => o.value === effort)?.hint}</span>
            {effortAdjusted && (
              <span className={s.effortHint} data-testid="models-effort-effective">
                {effortEffective ? t('composer.controls.effort.effective', { level: effortEffective }) : t('composer.controls.effort.disabled')}
              </span>
            )}
          </div>
          <p className={s.note}>{t('models.settingsHint', { path: t('settings.provider') })}</p>
        </Card>
      </section>
    </div>
  );
}
