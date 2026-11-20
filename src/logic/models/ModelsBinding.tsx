/**
 * Models —— 当前模型卡片、reasoning effort 与 coding plan 切换的绑定。
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import {
  zhuye_agent_status,
  zhuye_get_config,
  zhuye_set_effort,
  zhuye_set_model,
} from '@/utils/commands';
import { zhuye_get_effort } from '@/utils/commands/permissions';
import { ALL_EFFORTS, useEffortCapability, type Effort } from '@/logic/composer/useEffortCapability';
import { useModelAbilities } from '@/logic/models/useModelAbilities';
import { useI18n } from '@/utils/i18n';
import { formatTokens } from '@/utils/formatTokens';
import { listPlans, maskKey, readActiveCredential, readActiveProvider, type PlanEntry } from '@/logic/settings/config/plans';
import type { ModelsViewProps } from '@/contracts/models';

const REASONING_EFFORTS = ALL_EFFORTS;

export function ModelsBinding({ view: View }: { view: ComponentType<ModelsViewProps> }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [effort, setEffort] = useState<Effort>('medium');
  const [saved, setSaved] = useState(false);
  const capability = useEffortCapability();

  const statusQuery = useQuery({ queryKey: ['agent-status'], queryFn: zhuye_agent_status, staleTime: 30_000 });
  useEffect(() => {
    let cancelled = false;
    zhuye_get_effort()
      .then((level) => {
        if (!cancelled && REASONING_EFFORTS.includes(level as Effort)) setEffort(level as Effort);
      })
      .catch(() => { /* 读不到时保持默认 */ });
    return () => { cancelled = true; };
  }, []);

  const configQuery = useQuery({ queryKey: ['config'], queryFn: zhuye_get_config, staleTime: 30_000 });

  const effortOptions = useMemo(() => {
    const options = new Set<Effort>(capability.options);
    options.add(effort);
    return REASONING_EFFORTS.filter((level) => options.has(level));
  }, [capability.options, effort]);

  const effortMutation = useMutation({
    mutationFn: async (level: Effort) => zhuye_set_effort(level),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const switchProviderMutation = useMutation({
    mutationFn: async ({ provider, model, label }: Pick<PlanEntry, 'provider' | 'model' | 'label'>) =>
      zhuye_set_model(provider, model, label).then((spec) => spec),
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
  // 当前模型能力(models.dev 目录):窗口 / 输出上限 / 视觉 / 思考,
  // 卡片展示与视觉降级判断共用一份查询缓存。标签在绑定层拼好本地化
  // 文案,渲染层只消费字符串(渲染层不可依赖 @/utils)。
  const abilities = useModelAbilities(status?.model);
  const abilityTags: string[] = [];
  if (abilities.data) {
    const a = abilities.data;
    if (a.context_window != null && a.context_window > 0) {
      abilityTags.push(`${formatTokens(a.context_window)} ${t('common.ctxTag')}`);
    }
    if (a.max_output_tokens != null && a.max_output_tokens > 0) {
      abilityTags.push(`${formatTokens(a.max_output_tokens)} ${t('common.outTag')}`);
    }
    if (a.supports_vision != null) {
      abilityTags.push(a.supports_vision ? t('common.visionTag') : t('common.noVisionTag'));
    }
    if (a.supports_reasoning != null) {
      abilityTags.push(
        a.supports_reasoning ? t('common.reasoningTag') : t('common.noReasoningTag'),
      );
    }
  }

  const isDefaultPlan = (plan: PlanEntry): boolean => {
    if (plan.provider !== activeProvider) return false;
    return activeCredential
      ? plan.label === activeCredential
      : plan.topLevel && plan.label === 'default';
  };

  const modelPlans = plans.map((plan) => ({
    ...plan,
    apiKey: maskKey(plan.apiKey),
    isDefault: isDefaultPlan(plan),
    switching: switchProviderMutation.isPending
      && switchProviderMutation.variables?.label === plan.label
      && switchProviderMutation.variables.provider === plan.provider,
  }));
  const effortHints: Record<Effort, string> = {
    low: t('models.effort.lowDesc'),
    medium: t('models.effort.mediumDesc'),
    high: t('models.effort.highDesc'),
    max: t('models.effort.maxDesc'),
    ultra: t('models.effort.ultraDesc'),
  };

  return <View
    t={t}
    loading={statusQuery.isLoading}
    hasModel={hasModel}
    model={status?.model}
    abilityTags={abilityTags}
    workspace={status?.workspace}
    degradedReason={status?.degraded_reason ?? null}
    plans={modelPlans}
    effort={effort}
    effortOptions={effortOptions.map((level) => ({ value: level, label: level, hint: effortHints[level] }))}
    effortAdjusted={capability.adjusted}
    effortEffective={capability.effective}
    saved={saved}
    onGoSettings={() => window.location.assign('#/settings')}
    onSwitchPlan={(plan) => switchProviderMutation.mutate({ provider: plan.provider, model: plan.model, label: plan.label })}
    onEffortChange={setEffort}
    onApplyEffort={() => effortMutation.mutate(effort)}
  />;
}
