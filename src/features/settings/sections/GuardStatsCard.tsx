/**
 * GuardStatsCard —— F01 prompt_guard 裁决统计（安全段）。
 *
 * 引擎侧 `[prompt_guard]` 自 F01 起**默认开启**：工具输出与外部工具定义
 * 都做注入扫描，Block 拦截 / Review 标注。本卡片通过
 * `Op::QueryGuardStats` 拉取会话累计计数，让「guard 开着吗、拦了多少」
 * 在设置页可见 —— 此前该开关只在 config.toml 里，用户无从确认生效。
 */
import { useState } from 'react';
import { ShieldAlert, Loader2 } from 'lucide-react';
import { Button, Card, Icon } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { reflect_query_guard_stats } from '@/utils/commands/skills';
import s from './GuardStatsCard.module.css';

export function GuardStatsCard() {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queried, setQueried] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      // 应答经 `guard_stats` 事件回推，reducer 写入 agentStore.guardStats。
      await reflect_query_guard_stats();
      setQueried(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card level="flat" padding="sm" className={s.card} data-testid="settings-guard-stats">
      <div className={s.header}>
        <Icon icon={ShieldAlert} size={14} />
        <strong>{t('settings.guardStats.title')}</strong>
        <Button size="sm" variant="ghost" disabled={busy} onClick={run}>
          {busy ? <Icon icon={Loader2} size={12} className={s.spin} /> : null}
          {t('settings.guardStats.query')}
        </Button>
      </div>
      <p className={s.hint}>{t('settings.guardStats.hint')}</p>
      {queried && (
        <p className={s.hint} data-testid="settings-guard-stats-sent">
          {t('settings.guardStats.sent')}
        </p>
      )}
      {error && <p className={s.error}>{error}</p>}
    </Card>
  );
}
