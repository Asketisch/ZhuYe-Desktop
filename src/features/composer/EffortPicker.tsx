/**
 * EffortPicker —— 底栏右侧思考深度 pill。
 *
 * 自原控制行收进卡内：`zhuye_get_effort` 回读 + `zhuye_set_effort`
 * 设置（乐观更新 —— 协议无 effort 变更事件，读回仅在下次挂载时刷新）。
 * 档位只给当前模型支持的子集（useEffortCapability，按模型分键查询）；
 * 显示值 = 当前模型生效档（effective，换模型即重算，不顶旧模型偏好），
 * 偏好保留在槽位、切回支持模型自动恢复。档位文案直接显示英文原词
 * （协议/厂商原始档位字，low/medium/high/…），不做本地化映射。
 *
 * v1.x 偏好持久化：选档只写线程内存槽位，换绑（切会话/热重载/切模型/
 * 重启）会用 `[model].reasoning_effort` 配置默认重置 —— 显式选择记
 * per-session 偏好（effortPreference），挂载与配置重载时同步回槽位。
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { subscribeAgentEvent } from '@/services/agentEventBus';
import { zhuye_get_effort, zhuye_set_effort } from '@/utils/commands/permissions';
import { useI18n } from '@/utils/i18n';
import { useAgentStore } from '@/stores/agentStore';
import { syncEffortPreference, writeEffortPreference } from '@/stores/agent/effortPreference';
import { ALL_EFFORTS, useEffortCapability } from './useEffortCapability';
import s from '@/render/composer/EffortPicker.module.css';

type Level = (typeof ALL_EFFORTS)[number];

function normalize(value: string): Level {
  return (ALL_EFFORTS as readonly string[]).includes(value) ? (value as Level) : 'low';
}

export function EffortPicker() {
  const { t } = useI18n();
  // 思考强度能力(按当前模型):只提供模型支持的档位,并把「用户选择」与
  // 「实际生效」分开显示 —— 偏好保留,换模型后自动重算。
  const capability = useEffortCapability();
  const sessionId = useAgentStore((st) => st.loadedSessionId);
  const [effort, setEffort] = useState<Level>('low');

  // 挂载 / 配置重载都会先用配置默认重置槽位 —— 同步用户偏好后再回读,
  // pill 恢复到用户显式选过的档（无偏好时 sync 为 no-op,显示配置默认）。
  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      syncEffortPreference(useAgentStore.getState().loadedSessionId).finally(() => {
        if (cancelled) return;
        zhuye_get_effort()
          .then((level) => {
            if (!cancelled) setEffort(normalize(level));
          })
          .catch(() => {/* 回读失败保持默认 */});
      });
    void refresh();
    const unsubscribe = subscribeAgentEvent((event) => {
      if (event.msg.type === 'config_reloaded') {
        void refresh();
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 换模型后显示档位跟随「当前模型生效档」（capability.effective）——
  // requested 是线程槽位的原始偏好,从支持 max 的模型切到 qwen 这类
  // 上限较低的模型时槽位仍是 max,不该继续顶在 pill 上。偏好本身不丢:
  // 钳制是无损投影,切回支持该档的模型 effective 自动恢复。
  const { known: capKnown, requested: capRequested, effective: capEffective, adjusted: capAdjusted } = capability;
  useEffect(() => {
    if (!capKnown) return;
    setEffort(capAdjusted && capEffective ? capEffective : capRequested);
  }, [capKnown, capRequested, capEffective, capAdjusted]);

  // 可选档位 = 模型支持的档位;∪ 当前显示值仅作 capability 就绪前的
  // 渲染安全（读回的槽位档可能不在当前模型列表,如 max → 不渲染空白）。
  const effortOptions = useMemo(() => {
    const options = new Set<Level>(capability.options);
    options.add(effort);
    return ALL_EFFORTS.filter((level) => options.has(level));
  }, [capability.options, effort]);

  const onSetEffort = (level: Level) => {
    setEffort(level);
    // 显式选择记 per-session 偏好 —— Op::SetEffort 只写线程内存槽位，
    // 换绑（切会话/热重载/切模型/重启）会用配置默认值重置档位；偏好
    // 在 bind / 热重载后由 syncEffortPreference 自动恢复。
    writeEffortPreference(sessionId, level);
    void zhuye_set_effort(level).catch(() => {
      // 乐观更新失败回滚读不到真值 —— 保持所选，下次挂载会对齐。
    });
  };

  // 触发器 tooltip:能力未知 / 降级时的补充说明。
  const title = !capability.known
    ? t('composer.controls.effort.unknownHint')
    : capability.adjusted
      ? capability.effective
        ? t('composer.controls.effort.clamped', { requested: capability.requested, effective: capability.effective })
        : t('composer.controls.effort.disabled')
      : undefined;

  return (
    <span className={s.wrap} data-testid="composer-effort-picker">
      <select
        className={s.select}
        value={effort}
        onChange={(event) => onSetEffort(normalize(event.target.value))}
        disabled={effortOptions.length === 0}
        title={title}
        aria-label={t('composer.controls.effortAria')}
        data-testid="composer-effort-select"
      >
        {effortOptions.map((level) => (
          <option key={level} value={level}>{level}</option>
        ))}
      </select>
      <ChevronDown size={12} className={s.caret} aria-hidden="true" />
    </span>
  );
}
