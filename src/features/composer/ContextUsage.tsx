/**
 * ContextUsage —— Composer 底栏的上下文用量环。
 *
 * 数据全部来自 agentStore（token_count 事件 + session_configured 的
 * context window 大小），无后端往返。**常驻显示**：无数据时渲染空环
 * （未知 ≠ 不显示 —— 环是底栏的固定锚点），有数据时按比例填充；
 * 百分比 / 输入输出 token 细分收进 tooltip，≥80% 转 warning 色。
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

  const known = !!tokens && !!windowSize && windowSize > 0 && tokens.total > 0;
  const ratio = known ? Math.min(1, tokens.total / (windowSize as number)) : 0;
  const pct = Math.round(ratio * 100);
  const warn = known && ratio >= WARN_RATIO;

  const tooltip = !known
    ? t('composer.contextUnknown')
    : warn
      ? t('composer.contextNearFull', { pct: String(pct) })
      : t('composer.contextTooltip', {
          pct: String(pct),
          input: formatTokens(tokens!.input),
          output: formatTokens(tokens!.output),
          cached: formatTokens(tokens!.cached),
        });

  return (
    <div
      className={s.usage}
      role="img"
      data-warn={warn || undefined}
      data-known={known || undefined}
      title={tooltip}
      data-testid="composer-context-usage"
      aria-label={tooltip}
    >
      {/* 底环常驻灰、进度环按 dasharray 填充；r=10/stroke=4 的比例
          与底栏 pill 高度对齐。 */}
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" opacity="0.25" strokeWidth="4" />
        <circle
          cx="12" cy="12" r="10" fill="none" stroke="currentColor" opacity="0.7" strokeWidth="4"
          pathLength="100" strokeDasharray={`${ratio * 100} 100`}
          strokeLinecap="round" transform="rotate(-90 12 12)"
        />
      </svg>
    </div>
  );
}
