import type { StatusBarProps } from '@/contracts/harness/statusBar';
import s from './ContextGauge.module.css';

const RADIUS = 7;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
export type GaugeLevel = 'normal' | 'warning' | 'critical';
export function gaugeLevel(ratio: number): GaugeLevel { return ratio >= 0.9 ? 'critical' : ratio >= 0.75 ? 'warning' : 'normal'; }
export function dashOffset(ratio: number): number { return CIRCUMFERENCE * (1 - Math.min(1, Math.max(0, ratio))); }

export function ContextGauge({ t, ratio, pct, windowSize, usedTokens }: {
  t: StatusBarProps['t']; ratio: number; pct: number; windowSize: number; usedTokens: number;
}) {
  const level = gaugeLevel(ratio); const label = `${pct}%`;
  return <span className={`${s.gauge} ${s[level]}`} data-testid="context-gauge" data-level={level} title={`${label} · ${usedTokens}/${windowSize}`}>
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle className={s.track} cx="9" cy="9" r={RADIUS} fill="none" strokeWidth="2.5" /><circle className={s.arc} cx="9" cy="9" r={RADIUS} fill="none" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={CIRCUMFERENCE} strokeDashoffset={dashOffset(ratio)} transform="rotate(-90 9 9)" /></svg>
    <span className={s.label}>{label}</span><span className={s.srOnly}>{t('chat.contextWarn', { pct: String(pct) })}</span>
  </span>;
}
