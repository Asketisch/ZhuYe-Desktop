/**
 * UpdatesSection —— 应用更新检查。
 *
 * 后端 `reflect_check_update` 探测上游 releases(默认 GitHub latest,
 * 可用 env `REFLECT_UPDATE_URL` 覆盖),返回当前版本 / 最新版本 / 发布
 * 说明 / 发布页 URL。此前该命令有后端、有 IPC 包装,但**界面里没有任何
 * 入口** —— 用户不知道自己跑的是不是最新版。
 *
 * 设计约束:
 * - 探测走网络,可能失败;失败**如实展示** `error`,不静默吞掉。
 * - 不自动下载/安装 —— 只做「有没有新版本 + 去哪儿看」,安装仍由用户
 *   在发布页自行完成(桌面端当前没有自动更新器)。
 */
import { useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { Badge, Button, Card, Icon } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { reflect_check_update, type ReflectUpdateInfo } from '@/utils/commands/updates';
import s from './UpdatesSection.module.css';

export function UpdatesSection() {
  const { t } = useI18n();
  const [info, setInfo] = useState<ReflectUpdateInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setBusy(true);
    try {
      setInfo(await reflect_check_update());
    } catch (e) {
      // invoke 本身失败(命令不存在 / 桥断了)也如实报出来。
      setInfo({
        currentVersion: '',
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: null,
        releaseNotes: null,
        probedAt: Date.now(),
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card level="flat" padding="sm" className={s.card} data-testid="settings-updates">
      <div className={s.header}>
        <Icon icon={RefreshCw} size={14} />
        <strong>{t('settings.updates.title')}</strong>
        {info && (
          <Badge variant={info.error ? 'warning' : info.updateAvailable ? 'accent' : 'success'}>
            {info.error
              ? t('settings.updates.probeFailed')
              : info.updateAvailable
                ? t('settings.updates.available', { version: info.latestVersion ?? '?' })
                : t('settings.updates.upToDate')}
          </Badge>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void check()}
          data-testid="updates-check"
        >
          {busy ? <Loader2 size={12} className={s.spin} /> : <RefreshCw size={12} />}
          {t('settings.updates.check')}
        </Button>
      </div>

      {info && !info.error && (
        <p className={s.hint} data-testid="updates-current">
          {t('settings.updates.current', { version: info.currentVersion })}
        </p>
      )}

      {info?.error && (
        <p className={s.error} data-testid="updates-error">
          {info.error}
        </p>
      )}

      {info?.updateAvailable && (
        <div className={s.body} data-testid="updates-available">
          {info.releaseNotes && <pre className={s.notes}>{info.releaseNotes}</pre>}
          {info.releaseUrl && (
            <a className={s.link} href={info.releaseUrl} target="_blank" rel="noreferrer">
              <Icon icon={Download} size={12} />
              {t('settings.updates.openRelease')}
            </a>
          )}
        </div>
      )}
    </Card>
  );
}
