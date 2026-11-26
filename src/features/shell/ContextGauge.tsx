/**
 * ContextGauge —— F52 上下文用量环形仪表（常驻可视化）。
 *
 * 与 ContextBanner（压缩预警，只在高水位出现）互补：gauge 常驻，
 * 让用户随时知道"还剩多少上下文"。档位语义与引擎侧
 * `zhuye-telemetry::desktop_contracts::GaugeLevel` 对齐：
 * Normal(<75%) / Warning(≥75%) / Critical(≥90%)。
 */
import { useI18n } from '@/utils/i18n';
import { useContextRatio } from '@/logic/shell/useContextRatio';
import s from '@/render/shell/ContextGauge.module.css';

const RADIUS = 7;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export type GaugeLevel = 'normal' | 'warning' | 'critical';

/** 与引擎 `GaugeLevel` 同语义的档位判定（纯函数，供测试与组件共用）。 */
export function gaugeLevel(ratio: number): GaugeLevel {
  if (ratio >= 0.9) return 'critical';
  if (ratio >= 0.75) return 'warning';
  return 'normal';
}

/** 环形仪表的 stroke-dashoffset（纯函数：ratio 0..1 → offset）。 */
export function dashOffset(ratio: number): number {
  const clamped = Math.min(1, Math.max(0, ratio));
  return CIRCUMFERENCE * (1 - clamped);
}

export function ContextGauge() {
  const { t } = useI18n();
  const { ratio, pct, windowSize, usedTokens } = useContextRatio();

  // 窗口未知 / 尚无 token 上报 → 不渲染（避免误导性的空环）。
  if (ratio === null || pct === null || !windowSize) return null;

  const level = gaugeLevel(ratio);
  const label = `${pct}%`;

  return (
    <span
      className={`${s.gauge} ${s[level]}`}
      data-testid="context-gauge"
      data-level={level}
      title={`${label} · ${usedTokens}/${windowSize}`}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle className={s.track} cx="9" cy="9" r={RADIUS} fill="none" strokeWidth="2.5" />
        <circle
          className={s.arc}
          cx="9"
          cy="9"
          r={RADIUS}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset(ratio)}
          transform="rotate(-90 9 9)"
        />
      </svg>
      <span className={s.label}>{label}</span>
      <span className={s.srOnly}>{t('chat.contextWarn', { pct: String(pct) })}</span>
    </span>
  );
}
