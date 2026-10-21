/**
 * SecurityScanCard —— 一次性 `cargo audit` 安全扫描。
 *
 * 核心的 `run_cargo_audit` 是**真实实现**（30s 超时 + 管道排空，IO 错误落
 * 结构化报告而非 panic）。GUI 此前只能自己开终端跑 —— 这里给一个入口。
 *
 * 冷启动要拉 RustSec advisory DB（网络），离线环境会超时 —— 超时是核心的
 * 硬约束，此处不覆盖，UI 明确提示「可能耗时数十秒」。
 */
import { useState } from 'react';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { Badge, Button, Card, Icon } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { reflect_run_security_scan, type SecurityScanResult } from '@/utils/commands/security';
import s from './SecurityScanCard.module.css';

export function SecurityScanCard() {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<SecurityScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setReport(await reflect_run_security_scan());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card level="flat" padding="sm" className={s.card} data-testid="settings-security-scan">
      <div className={s.header}>
        <Icon icon={ShieldCheck} size={14} />
        <strong>{t('settings.securityScan.title')}</strong>
        {report && (
          <Badge variant={report.ran ? (report.exitCode === 0 ? 'success' : 'warning') : 'neutral'}>
            {report.ran
              ? t('settings.securityScan.ran', { code: String(report.exitCode ?? 0) })
              : t('settings.securityScan.unavailable')}
          </Badge>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void run()}
          data-testid="security-scan-run"
        >
          {busy ? <Loader2 size={12} className={s.spin} /> : <ShieldCheck size={12} />}
          {t('settings.securityScan.run')}
        </Button>
      </div>
      <p className={s.hint}>{t('settings.securityScan.hint')}</p>
      {error && (
        <p className={s.error} data-testid="security-scan-error">
          {error}
        </p>
      )}
      {report && (
        <div className={s.report} data-testid="security-scan-report">
          <p className={s.summary}>{report.summary}</p>
          {report.output && <pre className={s.output}>{report.output}</pre>}
        </div>
      )}
    </Card>
  );
}
