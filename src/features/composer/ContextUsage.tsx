/**
 * ContextUsage —— Composer 角落的上下文用量指示。
 *
 * 数据全部来自 agentStore（token_count 事件 + session_configured 的
 * context window 大小），无后端往返。无数据（未知窗口大小 / 尚无
 * token 上报）时不渲染。
 *
 * - < 80%：圆形进度 + 百分比；
 * - ≥ 80%：warning 色，tooltip 提示 /compact。
 */
import { useAgentStore } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';
import s from '@/render/composer/Composer.module.css';

const WARN_RATIO = 0.8;

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

export function ContextUsage() {
  const { t } = useI18n();
  const tokens = useAgentStore((st) => st.tokens);
  const windowSize = useAgentStore((st) => st.contextWindowSize);

  if (!tokens || !windowSize || windowSize <= 0 || tokens.total <= 0) return null;

  const ratio = Math.min(1, tokens.total / windowSize);
  const pct = Math.round(ratio * 100);
  const warn = ratio >= WARN_RATIO;

  const tooltip = warn
    ? t('composer.contextNearFull', { pct: String(pct) })
    : t('composer.contextTooltip', {
        pct: String(pct),
        input: formatTokens(tokens.input),
        output: formatTokens(tokens.output),
        cached: formatTokens(tokens.cached),
      });

  return (
    <div
      className={s.usage}
      data-warn={warn || undefined}
      title={tooltip}
      data-testid="composer-context-usage"
      aria-label={tooltip}
    >
      <svg width="28" height="28" viewBox="0 0 36 36" aria-hidden="true">
        <circle cx="18" cy="18" r="15" fill="none" stroke="var(--line-2)" strokeWidth="3" />
        <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3"
          pathLength="100" strokeDasharray={`${pct} 100`} transform="rotate(-90 18 18)" />
      </svg>
      <span className={s.usagePct}>{pct}%</span>
    </div>
  );
}
