/**
 * Models —— 当前 model 卡片 + reasoning effort 分段控件（CSS Modules 版）。
 *
 * 数据源:reflect_agent_status + reflect_set_effort。
 * v1.x coding plan:追加「编码计划」区 —— 从 config 解析 plan 列表,
 * 一键把某个 plan 设为默认(走 reflect_set_model:写 `[active].provider`
 * + `[<provider>].model` 段级模型 → 后端热重载 provider 栈,无需重启)。
 * 判定与切换都必须落到 plan 粒度:同 provider 下有多个 plan 时仅凭
 * provider 无法区分,且只切 provider 不写模型名的话,实际使用的模型
 * 根本不会变。
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cpu, Folder, AlertTriangle, CheckCircle2, Zap } from 'lucide-react';
import {
  reflect_agent_status,
  reflect_get_config,
  reflect_set_effort,
  reflect_set_model,
} from '@/utils/commands';
import { reflect_get_effort } from '@/utils/commands/permissions';
import { Card, Badge, Button, Icon, SegmentedControl, EmptyState } from '@/features/design-system';
import { useI18n, type LocaleKey } from '@/utils/i18n';
import {
  listPlans,
  maskKey,
  readActiveCredential,
  readActiveProvider,
  type PlanEntry,
} from '@/features/settings/config/plans';
import s from './ModelsView.module.css';

// 上游 v1.x 起 max / ultra 为新增档位(按模型能力表发送前钳制)。
const REASONING_EFFORTS = ['low', 'medium', 'high', 'max', 'ultra'] as const;
type Effort = (typeof REASONING_EFFORTS)[number];

const EFFORT_HINTS: Record<Effort, LocaleKey> = {
  low: 'models.effort.lowDesc',
  medium: 'models.effort.mediumDesc',
  high: 'models.effort.highDesc',
  max: 'models.effort.maxDesc',
  ultra: 'models.effort.ultraDesc',
};

export function ModelsView() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [effort, setEffort] = useState<Effort>('medium');
  const [saved, setSaved] = useState(false);

  const statusQuery = useQuery({
    queryKey: ['agent-status'],
    queryFn: reflect_agent_status,
    staleTime: 30_000,
  });

  // effort 回读：后端 AgentConfig::current_effort（此前固定 'medium'，
  // 显示值与运行时实际值脱节）。
  useEffect(() => {
    let cancelled = false;
    reflect_get_effort()
      .then((level) => {
        if (!cancelled && REASONING_EFFORTS.includes(level as Effort)) setEffort(level as Effort);
      })
      .catch(() => {/* 读不到时保持默认 */});
    return () => {
      cancelled = true;
    };
  }, []);

  const configQuery = useQuery({
    queryKey: ['config'],
    queryFn: reflect_get_config,
    staleTime: 30_000,
  });

  const effortMutation = useMutation({
    mutationFn: async (level: Effort) => reflect_set_effort(level),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  // 一键把某个 plan 设为默认:reflect_set_model 写 `[active].provider` +
  // `[active].credential`(钉住该凭证条目)+ 条目/段级 model,后端热重载
  // provider 栈并强制重绑当前会话。v1.5 起钉住语义保证同 provider 的多个
  // plan 切换后请求真正落到被选中的凭证端点。
  const switchProviderMutation = useMutation({
    mutationFn: async ({ key, provider, model, label }: { key: string; provider: string; model: string; label: string }) =>
      reflect_set_model(provider, model, label).then((spec) => ({ key, spec })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-status'] });
      qc.invalidateQueries({ queryKey: ['config'] });
    },
  });

  const toml = configQuery.data ?? '';
  const plans = listPlans(toml);
  const activeProvider = readActiveProvider(toml);
  const activeCredential = readActiveCredential(toml);

  const status = statusQuery.data;
  const hasModel = Boolean(status?.has_model);

  /** plan 是否就是当前默认:provider 生效 且 label 与 `[active].credential`
   *  钉住一致(未钉住时仅顶层隐式 default plan 算默认)。判定必须**排他**
   *  —— 此前按「段级 model 与 plan.model 相等」判,两个同 provider 空
   *  model 的 plan 会同时被判成默认、按钮全部禁用,永远切不动。 */
  const isDefaultPlan = (plan: PlanEntry): boolean => {
    if (plan.provider !== activeProvider) return false;
    return activeCredential
      ? plan.label === activeCredential
      : plan.topLevel && plan.label === 'default';
  };

  return (
    <div className={s.root}>
      <header className={s.header}>
        <h1 className={s.title}>{t('models.title')}</h1>
        <p className={s.subtitle}>{t('models.subtitle')}</p>
      </header>

      {/* Current model */}
      <section>
        <h2 className={s.sectionTitle}>{t('models.currentModel')}</h2>
        {statusQuery.isLoading ? (
          <Card level="outlined" padding="md">
            <p className={s.loading}>{t('common.loading')}</p>
          </Card>
        ) : hasModel ? (
          <Card level="outlined" padding="lg" className={s.modelCard}>
            <div className={s.modelIcon}>
              <Icon icon={Cpu} size={24} />
            </div>
            <div className={s.modelBody}>
              <div className={s.modelNameRow}>
                <code className={s.modelName}>{status?.model}</code>
                <Badge variant="success" dot>{t('about.ready')}</Badge>
              </div>
              {status?.workspace && (
                <div className={s.workspaceRow}>
                  <Icon icon={Folder} size={12} />
                  <code className={s.workspace}>{status.workspace}</code>
                </div>
              )}
            </div>
          </Card>
        ) : (
          <Card level="outlined" padding="lg">
            <EmptyState
              icon={<Icon icon={AlertTriangle} />}
              title={t('models.noProvider')}
              description={
                <>
                  {status?.degraded_reason ?? t('models.noProviderDesc')} {t('models.configureHint')}
                </>
              }
              action={<Button variant="primary" size="sm" onClick={() => window.location.assign('#/settings')}>{t('palette.item.goSettings')}</Button>}
            />
          </Card>
        )}
      </section>

      {/* Coding plans —— 一键切换默认供应商 */}
      <section>
        <h2 className={s.sectionTitle}>{t('models.plans')}</h2>
        {plans.length === 0 ? (
          <Card level="outlined" padding="lg">
            <p className={s.loading}>{t('models.plansEmpty')}</p>
          </Card>
        ) : (
          <div className={s.planList}>
            {plans.map((plan) => {
              const isDefault = isDefaultPlan(plan);
              return (
                <Card key={`${plan.provider}/${plan.label}`} level="outlined" padding="md" className={s.planCard}>
                  <div className={s.planMain}>
                    <div className={s.planTitleRow}>
                      <code className={s.planLabel}>{plan.label}</code>
                      <Badge variant={isDefault ? 'success' : 'info'}>{plan.provider}</Badge>
                      {plan.quota?.checkVia && (
                        <Badge variant="warning">
                          <Icon icon={Zap} size={10} /> {plan.quota.checkVia}
                        </Badge>
                      )}
                    </div>
                    <div className={s.planMetaRow}>
                      <span>{maskKey(plan.apiKey)}</span>
                      {plan.model && <span>{plan.model}</span>}
                      {plan.baseUrl && <span>{plan.baseUrl}</span>}
                    </div>
                  </div>
                  <Button
                    variant={isDefault ? 'ghost' : 'primary'}
                    size="sm"
                    disabled={isDefault || switchProviderMutation.isPending}
                    loading={
                      switchProviderMutation.isPending &&
                      switchProviderMutation.variables?.key === `${plan.provider}/${plan.label}`
                    }
                    onClick={() =>
                      switchProviderMutation.mutate({
                        key: `${plan.provider}/${plan.label}`,
                        provider: plan.provider,
                        model: plan.model,
                        label: plan.label,
                      })
                    }
                  >
                    {isDefault ? t('models.planIsDefault') : t('models.planSetDefault')}
                  </Button>
                </Card>
              );
            })}
          </div>
        )}
        <p className={s.note}>{t('models.plansHint')}</p>
      </section>

      {/* Reasoning effort */}
      <section>
        <h2 className={s.sectionTitle}>{t('models.effort')}</h2>
        <Card level="outlined" padding="lg">
          <div className={s.effortHeader}>
            <div className={s.effortLabel}>
              <Icon icon={Zap} size={14} />
              <span>{t('models.effortHint')}</span>
            </div>
            <SegmentedControl<Effort>
              value={effort}
              onChange={(v) => setEffort(v)}
              options={REASONING_EFFORTS.map((e) => ({ value: e, label: e, hint: t(EFFORT_HINTS[e]) }))}
              stacked
            />
          </div>
          <div className={s.effortApply}>
            <Button
              variant="primary"
              onClick={() => effortMutation.mutate(effort)}
              loading={effortMutation.isPending}
              leftIcon={<Icon icon={CheckCircle2} size={14} />}
            >
              {saved ? t('models.applied') : t('models.applyEffort')}
            </Button>
            <span className={s.effortHint}>{t(EFFORT_HINTS[effort])}</span>
          </div>
          <p className={s.note}>
            {t('models.settingsHint', { path: t('settings.provider') })}
          </p>
        </Card>
      </section>
    </div>
  );
}
