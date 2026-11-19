import { Wifi, Save, X, RefreshCw, Loader2, Info } from 'lucide-react';
import type { RemoteConfigDraft, RemoteViewProps } from '@/contracts/remote';
import { PageShell } from '../shell/PageShell';
import { Badge } from '../design-system/Badge';
import { Button } from '../design-system/Button';
import { Card } from '../design-system/Card';
import { EmptyState } from '../design-system/EmptyState';
import { Icon } from '../design-system/Icon';
import { Spinner } from '../design-system/Spinner';
import s from './RemoteView.module.css';

export function RemoteView({ t, ctrl, copyOk, onCopyPreview }: RemoteViewProps) {
  return (
    <PageShell
      icon={Wifi}
      title={t('remote.title')}
      subtitle={t('remote.subtitle')}
      width="lg"
      actions={
        <button
          type="button"
          className={s.refreshBtn}
          onClick={ctrl.refetch}
          data-testid="remote-refresh"
        >
          <Icon icon={RefreshCw} size={12} /> {t('common.refresh')}
        </button>
      }
    >
      {/* iOS connection setup */}
      <Card level="outlined" padding="md" className={s.section} data-testid="remote-config-card">
        <header className={s.sectionHeader}>
          <div>
            <strong>{t('remote.iosConnection')}</strong>
            <div className={s.sectionHint}>
              {t('remote.iosHint')}
            </div>
          </div>
          <div className={s.sectionActions}>
            <Badge variant={ctrl.config?.isReady ? 'success' : 'neutral'}>
              {ctrl.config?.isReady ? t('remote.ready') : t('remote.notConfigured')}
            </Badge>
            <button
              type="button"
              className={s.editBtn}
              onClick={ctrl.toggleShowForm}
              data-testid="remote-edit-btn"
            >
              {ctrl.showForm ? <Icon icon={X} size={12} /> : <Save size={12} />}
              {' '}
              {ctrl.showForm ? t('common.cancel') : ctrl.config?.isReady ? t('remote.edit') : t('remote.configure')}
            </button>
          </div>
        </header>

        {ctrl.config && !ctrl.showForm && (
          <dl className={s.configList} data-testid="remote-config-display">
            <div className={s.configRow}>
              <dt>{t('remote.endpoint')}</dt>
              <dd>{ctrl.config.endpoint || t('remote.emptyValue')}</dd>
            </div>
            <div className={s.configRow}>
              <dt>{t('remote.host')}</dt>
              <dd>{ctrl.config.host || t('remote.emptyValue')}</dd>
            </div>
            <div className={s.configRow}>
              <dt>{t('remote.port')}</dt>
              <dd>{ctrl.config.port}</dd>
            </div>
            <div className={s.configRow}>
              <dt>{t('remote.authToken')}</dt>
              <dd>{ctrl.config.authToken ? `${ctrl.config.authToken.slice(0, 4)}…` : t('remote.notSet')}</dd>
            </div>
            <div className={s.configRow}>
              <dt>{t('remote.autoConnect')}</dt>
              <dd>{ctrl.config.autoConnect ? t('remote.yes') : t('remote.no')}</dd>
            </div>
          </dl>
        )}

        {ctrl.showForm && (
          <form
            className={s.form}
            data-testid="remote-config-form"
            onSubmit={(e) => {
              e.preventDefault();
              void ctrl.save();
            }}
          >
            <label className={s.field}>
              {t('remote.host')}
              <input
                className={s.input}
                value={ctrl.draft.host}
                onChange={(e) => ctrl.patchDraft({ host: e.target.value } as Partial<RemoteConfigDraft>)}
                placeholder={t('remote.hostPlaceholder')}
                data-testid="remote-form-host"
              />
            </label>
            <label className={s.field}>
              {t('remote.port')}
              <input
                className={s.input}
                type="number"
                value={ctrl.draft.port}
                onChange={(e) =>
                  ctrl.patchDraft({ port: Number(e.target.value) || 4732 })
                }
                data-testid="remote-form-port"
              />
            </label>
            <label className={s.field}>
              {t('remote.authToken')}
              <input
                className={s.input}
                type="password"
                value={ctrl.draft.authToken}
                onChange={(e) => ctrl.patchDraft({ authToken: e.target.value })}
                placeholder={t('remote.tokenPlaceholder')}
                data-testid="remote-form-token"
              />
            </label>
            <label className={s.checkboxField}>
              <input
                type="checkbox"
                checked={ctrl.draft.autoConnect}
                onChange={(e) => ctrl.patchDraft({ autoConnect: e.target.checked })}
                data-testid="remote-form-auto-connect"
              />{' '}
              {t('remote.autoConnectLabel')}
            </label>
            <div className={s.formActions}>
              <button
                type="button"
                className={s.cancelBtn}
                onClick={ctrl.toggleShowForm}
                data-testid="remote-form-cancel"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className={s.submitBtn}
                disabled={ctrl.isMutating}
                data-testid="remote-form-submit"
              >
                {ctrl.isMutating ? <Icon icon={Loader2} size={12} /> : <Save size={12} />}
                {' '}{t('common.save')}
              </button>
            </div>
          </form>
        )}
      </Card>

      {/* Tailscale */}
      <Card level="outlined" padding="md" className={s.section} data-testid="remote-tailscale-card">
        <header className={s.sectionHeader}>
          <div>
            <strong>{t('remote.tailscale')}</strong>
            <div className={s.sectionHint}>
              {t('remote.tailscaleHint')}
            </div>
          </div>
          <Badge variant={!ctrl.tailscale ? 'neutral' : ctrl.tailscale.running ? 'success' : 'warning'}>
            {ctrl.tailscale?.installed ? (ctrl.tailscale.running ? t('remote.running') : t('remote.installed')) : t('remote.notInstalled')}
          </Badge>
        </header>

        {ctrl.tailscale && (
          <dl className={s.configList}>
            <div className={s.configRow}>
              <dt>{t('remote.suggestedHost')}</dt>
              <dd>{ctrl.tailscale.suggestedRemoteHost || t('remote.noDnsOrIp')}</dd>
            </div>
            {ctrl.tailscale.dnsName && (
              <div className={s.configRow}>
                <dt>{t('remote.dns')}</dt>
                <dd>{ctrl.tailscale.dnsName}</dd>
              </div>
            )}
            {ctrl.tailscale.tailnetName && (
              <div className={s.configRow}>
                <dt>{t('remote.tailnet')}</dt>
                <dd>{ctrl.tailscale.tailnetName}</dd>
              </div>
            )}
            {ctrl.tailscale.ipv4.length > 0 && (
              <div className={s.configRow}>
                <dt>{t('remote.ipv4')}</dt>
                <dd>{ctrl.tailscale.ipv4.join(', ')}</dd>
              </div>
            )}
            {ctrl.tailscale.message && (
              <div className={s.configRow}>
                <dt>{t('remote.message')}</dt>
                <dd>{ctrl.tailscale.message}</dd>
              </div>
            )}
          </dl>
        )}
      </Card>

      {/* v1.11 基建#12:远程网页访问状态服务器。 */}
      <Card level="outlined" padding="md" className={s.section} data-testid="remote-status-server-card">
        <header className={s.sectionHeader}>
          <div>
            <strong>{t('remote.statusServerTitle')}</strong>
            <div className={s.sectionHint}>
              {t('remote.statusServerDesc')}
            </div>
          </div>
          <Badge variant={ctrl.statusServerPort != null ? 'success' : 'neutral'} data-testid="remote-status-server-badge">
            {ctrl.statusServerPort != null
              ? t('remote.statusServerRunning', { port: ctrl.statusServerPort })
              : t('remote.statusServerOff')}
          </Badge>
        </header>
        <div className={s.sectionHeader}>
          <Button
            size="sm"
            variant="primary"
            disabled={ctrl.serverBusy || ctrl.statusServerPort != null}
            onClick={() => void ctrl.startServer(4732)}
            data-testid="remote-status-server-start"
          >
            {t('remote.statusServerStart')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={ctrl.serverBusy || ctrl.statusServerPort == null}
            onClick={() => void ctrl.stopServer()}
            data-testid="remote-status-server-stop"
          >
            {t('remote.statusServerStop')}
          </Button>
        </div>
        <p className={s.statusMsg}>{t('remote.statusServerHint')}</p>
      </Card>

      {/* Daemon hint */}
      <Card level="outlined" padding="md" className={s.section} data-testid="remote-daemon-card">
        <header className={s.sectionHeader}>
          <div>
            <strong>{t('remote.daemonHintTitle')}</strong>
            <div className={s.sectionHint}>
              {t('remote.daemonHintDesc')}
            </div>
          </div>
          <button
            type="button"
            className={s.copyBtn}
            onClick={onCopyPreview}
            disabled={!ctrl.previewCmd}
            data-testid="remote-copy-preview"
          >
            {copyOk ? t('common.copied') : t('common.copy')}
          </button>
        </header>
        {ctrl.previewCmd ? (
          <pre className={s.codeBlock} data-testid="remote-preview-text">{ctrl.previewCmd}</pre>
        ) : ctrl.loading ? (
          <div className={s.loading}>
            <Spinner size={16} />
          </div>
        ) : (
          <EmptyState
            icon={<Icon icon={Info} />}
            title={t('remote.previewUnavailable')}
            description={t('remote.previewUnavailableDesc')}
          />
        )}
      </Card>

      {/* Transport status */}
      <Card level="outlined" padding="md" className={s.section} data-testid="remote-status-card">
        <header className={s.sectionHeader}>
          <div>
            <strong>{t('remote.transportStatus')}</strong>
            <div className={s.sectionHint}>
              {t('remote.transportHint')}
            </div>
          </div>
          <Badge variant={ctrl.status?.state === 'connected' ? 'success' : 'neutral'}>
            {ctrl.status?.state ?? t('remote.unknown')}
          </Badge>
        </header>
        {ctrl.status?.message && (
          <p className={s.statusMsg}>{ctrl.status.message}</p>
        )}
      </Card>
    </PageShell>
  );
}