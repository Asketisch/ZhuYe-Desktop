/**
 * EffortPicker —— 底栏右侧思考深度 pill。
 *
 * 自原控制行收进卡内：`zhuye_get_effort` 回读 + `zhuye_set_effort`
 * 设置（乐观更新 —— 协议无 effort 变更事件，读回仅在下次挂载时刷新；
 * config_reloaded 事件触发重读）。档位只给当前模型支持的子集
 * （useEffortCapability），文案走 i18n 中文映射。
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { subscribeAgentEvent } from '@/services/agentEventBus';
import { zhuye_get_effort, zhuye_set_effort } from '@/utils/commands/permissions';
import { useI18n } from '@/utils/i18n';
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
  const [effort, setEffort] = useState<Level>('low');

  // 回读当前档位;配置重载(config_reloaded,含设置页保存 / 手改 TOML)
  // 时重读 —— 默认思考强度落地后引擎重绑新线程带新 initial,这里跟上。
  const rereadEffort = () => {
    zhuye_get_effort()
      .then((level) => setEffort(normalize(level)))
      .catch(() => {/* 回读失败保持当前显示 */});
  };
  useEffect(() => {
    let cancelled = false;
    zhuye_get_effort()
      .then((level) => {
        if (!cancelled) setEffort(normalize(level));
      })
      .catch(() => {/* 回读失败保持默认 */});
    const unsubscribe = subscribeAgentEvent((event) => {
      if (event.msg.type === 'config_reloaded') rereadEffort();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 可选档位 = 模型支持的档位 ∪ 用户当前选择(偏好保留,即使当前模型不支持)。
  const effortOptions = useMemo(() => {
    const options = new Set<Level>(capability.options);
    options.add(effort);
    return ALL_EFFORTS.filter((level) => options.has(level));
  }, [capability.options, effort]);

  const onSetEffort = (level: Level) => {
    setEffort(level);
    void zhuye_set_effort(level).catch(() => {
      // 乐观更新失败回滚读不到真值 —— 保持所选，下次挂载会对齐。
    });
  };

  // 触发器 tooltip:能力未知 / 降级时的补充说明。
  const title = !capability.known
    ? t('composer.controls.effort.unknownHint')
    : capability.adjusted
      ? capability.effective
        ? t('composer.controls.effort.effective', { level: t(`composer.effort.${capability.effective}`) })
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
          <option key={level} value={level}>{t(`composer.effort.${level}`)}</option>
        ))}
      </select>
      <ChevronDown size={12} className={s.caret} aria-hidden="true" />
    </span>
  );
}
