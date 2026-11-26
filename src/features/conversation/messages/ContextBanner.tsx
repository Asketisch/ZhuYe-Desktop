/**
 * ContextBanner —— 上下文窗口主动压缩预警（P2，阈值提示）。
 *
 * 此前只有 Composer 角落 80% 变色的 tooltip —— 属于被动发现；这里在
 * 消息流顶部主动出横幅：≥ 80% 显示 warning 横幅 + 一键 /compact。
 * 主动压缩后 token_count 事件回落，横幅自动消失。
 */
import { useEffect, useState } from 'react';
import { TriangleAlert, WandSparkles } from 'lucide-react';
import { Icon } from '@/features/harness/design-system';
import { useAgentStore } from '@/stores/agentStore';
import { useI18n } from '@/utils/i18n';
import { useContextRatio } from '@/logic/shell/useContextRatio';
import s from '@/render/messages/ContextBanner.module.css';

export function ContextBanner() {
  const { t } = useI18n();
  const { pct, warn } = useContextRatio();
  const compact = useAgentStore((st) => st.compact);
  const [dismissedAtPct, setDismissedAtPct] = useState<number | null>(null);

  // 占比跌破阈值（压缩完成 / 新会话）后重置 dismissed，下次再涨回来会再提示。
  useEffect(() => {
    if (!warn) setDismissedAtPct(null);
  }, [warn]);

  if (!warn || pct === null) return null;
  if (dismissedAtPct !== null && pct <= dismissedAtPct) return null;

  return (
    <div className={s.banner} role="status" data-testid="context-warning-banner">
      <Icon icon={TriangleAlert} size={13} />
      <span className={s.text}>{t('chat.contextWarn', { pct: String(pct) })}</span>
      <button
        type="button"
        className={s.compactBtn}
        onClick={() => void compact()}
        data-testid="context-compact-btn"
      >
        <Icon icon={WandSparkles} size={12} />
        {t('chat.contextCompactNow')}
      </button>
      <button
        type="button"
        className={s.dismiss}
        aria-label={t('common.close')}
        onClick={() => setDismissedAtPct(pct)}
      >
        ×
      </button>
    </div>
  );
}
