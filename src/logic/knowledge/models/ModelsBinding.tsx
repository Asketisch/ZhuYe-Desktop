/**
 * Models —— 当前模型卡片、reasoning effort 与模型组切换的绑定。
 *
 * 模型页按「模型组」列出（配置里只剩模型组一层）：每组一张卡片，
 * 「设为默认」写 `[active].group` —— 组 id 才是接入目标。
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
import { zhuye_get_effort } from '@/utils/commands/harness/permissions';
import { ALL_EFFORTS, useEffortCapability, type Effort } from '@/logic/input/composer/useEffortCapability';
import { useModelAbilities } from '@/logic/knowledge/models/useModelAbilities';
import {
  groupDisplayLabel,
  listGroups,
  readActiveCredential,
  readActiveGroup,
} from '@/logic/knowledge/models/modelGroups';
import { useI18n } from '@/utils/i18n';
import { formatTokens } from '@/utils/formatTokens';
import { useAgentStore } from '@/stores/agentStore';
import { writeEffortPreference } from '@/stores/agent/policy/effortPreference';
import type { ModelsViewProps } from '@/contracts/knowledge/models';

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
    onSuccess: (_result, level) => {
      // 与 composer EffortPicker 同款：显式选档记 per-session 偏好，
      // 换绑后由 syncEffortPreference 恢复（否则被配置默认重置）。
      writeEffortPreference(useAgentStore.getState().loadedSessionId, level);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  // 切换默认模型组：写 `[active].group` = 组 id（组级默认模型）。
  const switchGroupMutation = useMutation({
    mutationFn: async ({ group, model }: { group: string; model: string }) =>
      zhuye_set_model(group, model).then((spec) => spec),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-status'] });
      qc.invalidateQueries({ queryKey: ['config'] });
    },
  });

  const toml = configQuery.data ?? '';
  const groups = listGroups(toml);
  const activeGroupId = readActiveGroup(toml);
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

  const modelGroups = groups.map((group) => ({
    id: group.id,
    label: groupDisplayLabel(group),
    endpoint: group.endpoint,
    model: group.model,
    credentialCount: group.credentials.length,
    // 钉住凭据只在当前组内有效 —— 别组显示的钉住标记一律为空。
    pinnedCredential:
      group.id === activeGroupId && activeCredential ? activeCredential : null,
    isDefault: group.id === activeGroupId,
    switching:
      switchGroupMutation.isPending && switchGroupMutation.variables?.group === group.id,
  }));
  const effortHints: Record<Effort, string> = {
    low: t('models.effort.lowDesc'),
    medium: t('models.effort.mediumDesc'),
    high: t('models.effort.highDesc'),
    xhigh: t('models.effort.xhighDesc'),
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
    groups={modelGroups}
    effort={effort}
    // 档位文案直接显示英文原词（协议/厂商原始档位字），hint 保留中文说明。
    effortOptions={effortOptions.map((level) => ({ value: level, label: level, hint: effortHints[level] }))}
    effortAdjusted={capability.adjusted}
    effortEffectiveLabel={capability.effective ?? null}
    saved={saved}
    onGoSettings={() => window.location.assign('#/settings')}
    onSwitchGroup={(group) => switchGroupMutation.mutate({ group: group.id, model: group.model })}
    onEffortChange={setEffort}
    onApplyEffort={() => effortMutation.mutate(effort)}
  />;
}
