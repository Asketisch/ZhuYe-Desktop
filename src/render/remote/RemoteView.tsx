import { Loader2, PlugZap, RefreshCw, Save, Terminal, Trash2, Wifi, X } from 'lucide-react';
import type { RemoteConfigDraft, RemoteViewProps } from '@/contracts/remote';
import { PageShell } from '../shell/PageShell';
import { Spinner } from '../design-system/Spinner';
import kit from '../settings/SettingsPage.module.css';
import s from './RemoteView.module.css';

/** 分区卡（套件行卡 + 内边距画框）。 */
function Section({ testId, children }: { testId: string; children: React.ReactNode }) {
  return <section className={`${kit.card} ${kit.panelPad}`} data-testid={testId}>{children}</section>;
}

/** 分区头：标题 + 提示 + 右侧动作。 */
function SectionHead({ title, hint, children }: { title: string; hint: string; children?: React.ReactNode }) {
  return (
    <div className={kit.titleRow}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className={kit.rowLabel}>{title}</div>
        <div className={kit.resDesc}>{hint}</div>
      </div>
      {children}
    </div>
  );
}

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
          className={kit.btn}
          onClick={ctrl.refetch}
          data-testid="remote-refresh"
        >
          <RefreshCw size={12} strokeWidth={1.5} aria-hidden /> {t('common.refresh')}
        </button>
      }
    >
      {/* iOS connection setup */}
      <Section testId="remote-config-card">
        <SectionHead title={t('remote.iosConnection')} hint={t('remote.iosHint')}>
          <span className={kit.badge} data-fg={ctrl.config?.isReady || undefined}>
            {ctrl.config?.isReady ? t('remote.ready') : t('remote.notConfigured')}
          </span>
          <button
            type="button"
            className={`${kit.btn} ${kit.outline}`}
            onClick={ctrl.toggleShowForm}
            data-testid="remote-edit-btn"
          >
            {ctrl.showForm ? <X size={12} strokeWidth={1.5} aria-hidden /> : <Save size={12} strokeWidth={1.5} aria-hidden />}
            {' '}
            {ctrl.showForm ? t('common.cancel') : ctrl.config?.isReady ? t('remote.edit') : t('remote.configure')}
          </button>
        </SectionHead>

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
            <div className={kit.toolbar}>
              <span className={kit.grow} />
              <button
                type="button"
                className={`${kit.btn} ${kit.ghost}`}
                onClick={ctrl.toggleShowForm}
                data-testid="remote-form-cancel"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className={`${kit.btn} ${kit.primary}`}
                disabled={ctrl.isMutating}
                data-testid="remote-form-submit"
              >
                {ctrl.isMutating ? <Loader2 size={12} className={s.spin} /> : <Save size={12} strokeWidth={1.5} aria-hidden />}
                {' '}{t('common.save')}
              </button>
            </div>
          </form>
        )}
      </Section>

      {/* Tailscale */}
      <Section testId="remote-tailscale-card">
        <SectionHead title={t('remote.tailscale')} hint={t('remote.tailscaleHint')}>
          <span className={kit.badge} data-fg={Boolean(ctrl.tailscale?.running) || undefined}>
            {ctrl.tailscale?.installed ? (ctrl.tailscale.running ? t('remote.running') : t('remote.installed')) : t('remote.notInstalled')}
          </span>
        </SectionHead>

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
      </Section>

      {/* SSH 远程开发(state/remote.rs 会话层接缝) */}
      <Section testId="remote-ssh-card">
        <SectionHead title={t('remote.ssh.title')} hint={t('remote.ssh.hint')}>
          <span className={kit.badge} data-fg={ctrl.sshSessions.length > 0 || undefined} data-testid="remote-ssh-badge">
            {t('remote.ssh.sessionCount', { count: ctrl.sshSessions.length })}
          </span>
        </SectionHead>

        {/* 活跃会话 */}
        {ctrl.sshSessions.length > 0 && (
          <ul className={s.sshSessionList} data-testid="remote-ssh-sessions">
            {ctrl.sshSessions.map((session) => (
              <li key={session.sid} className={s.sshSessionRow}>
                <Terminal size={13} strokeWidth={1.5} aria-hidden />
                <span className={s.sshSessionHost}>{session.host}</span>
                <span className={s.sshSessionCwd}>{session.cwd}</span>
                {session.isForeground && (
                  <span className={kit.badge} data-fg>{t('remote.ssh.foreground')}</span>
                )}
                <span className={s.spacer} />
                <button type="button" className={`${kit.btn} ${kit.destructive}`} onClick={() => void ctrl.sshDisconnect(session.sid)} data-testid={`remote-ssh-disconnect-${session.sid}`}>
                  <Trash2 size={12} strokeWidth={1.5} aria-hidden />
                  {t('remote.ssh.disconnect')}
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* 连接表单 */}
        <div className={s.sshForm} data-testid="remote-ssh-form">
          <input
            className={s.sshInput}
            placeholder={t('remote.ssh.namePlaceholder')}
            value={ctrl.sshConnectForm.name}
            onChange={(e) => ctrl.patchSshConnectForm({ name: e.target.value })}
            data-testid="remote-ssh-name"
          />
          <input
            className={s.sshInput}
            placeholder={t('remote.ssh.hostPlaceholder')}
            value={ctrl.sshConnectForm.host}
            onChange={(e) => ctrl.patchSshConnectForm({ host: e.target.value })}
            data-testid="remote-ssh-host"
          />
          <input
            className={s.sshInput}
            placeholder={t('remote.ssh.cwdPlaceholder')}
            value={ctrl.sshConnectForm.cwd}
            onChange={(e) => ctrl.patchSshConnectForm({ cwd: e.target.value })}
            data-testid="remote-ssh-cwd"
          />
        </div>
        <div className={kit.toolbar}>
          <button type="button" className={`${kit.btn} ${kit.primary}`} disabled={ctrl.sshBusy || !ctrl.sshConnectForm.name || !ctrl.sshConnectForm.cwd} onClick={() => void ctrl.sshConnect()} data-testid="remote-ssh-connect">
            {ctrl.sshBusy ? <Loader2 size={12} className={s.spin} /> : <PlugZap size={12} strokeWidth={1.5} aria-hidden />}
            {t('remote.ssh.connect')}
          </button>
          <button type="button" className={`${kit.btn} ${kit.ghost}`} disabled={!ctrl.sshConnectForm.host} onClick={() => void ctrl.sshTest()} data-testid="remote-ssh-test">
            {ctrl.sshTesting ? <Loader2 size={12} className={s.spin} /> : null}
            {t('remote.ssh.test')}
          </button>
          <button type="button" className={`${kit.btn} ${kit.ghost}`} disabled={ctrl.sshBooting || !ctrl.sshConnectForm.name} onClick={() => void ctrl.sshBootstrap()} data-testid="remote-ssh-bootstrap">
            {ctrl.sshBooting ? <Loader2 size={12} className={s.spin} /> : null}
            {t('remote.ssh.bootstrap')}
          </button>
          <button type="button" className={`${kit.btn} ${kit.ghost}`} disabled={!ctrl.sshConnectForm.name || !ctrl.sshConnectForm.host} onClick={() => void ctrl.sshSaveHost()} data-testid="remote-ssh-save">
            <Save size={12} strokeWidth={1.5} aria-hidden />
            {t('remote.ssh.saveHost')}
          </button>
        </div>
        <p className={s.statusMsg}>{t('remote.ssh.prereq')}</p>

        {/* 已保存主机 */}
        {ctrl.sshHosts.length > 0 && (
          <ul className={s.sshSessionList} data-testid="remote-ssh-hosts">
            {ctrl.sshHosts.map((host) => (
              <li key={host.name} className={s.sshSessionRow}>
                <span className={s.sshSessionHost}>{host.name}</span>
                <span className={s.sshSessionCwd}>
                  {host.user ? `${host.user}@` : ''}
                  {host.host}
                  {host.port !== 22 ? `:${host.port}` : ''}
                </span>
                <span className={s.spacer} />
                <button type="button" className={`${kit.btn} ${kit.ghost}`} onClick={() => ctrl.patchSshConnectForm({ name: host.name, host: host.host, port: host.port, user: host.user ?? '' })} data-testid={`remote-ssh-fill-${host.name}`}>
                  {t('remote.ssh.fill')}
                </button>
                <button type="button" className={`${kit.btn} ${kit.destructive} ${kit.iconOnly}`} onClick={() => void ctrl.sshRemoveHost(host.name)} aria-label={t('agents.delete')} data-testid={`remote-ssh-remove-${host.name}`}>
                  <Trash2 strokeWidth={1.5} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* v1.11 基建#12:远程网页访问状态服务器。 */}
      <Section testId="remote-status-server-card">
        <SectionHead title={t('remote.statusServerTitle')} hint={t('remote.statusServerDesc')}>
          <span className={kit.badge} data-fg={ctrl.statusServerPort != null || undefined} data-testid="remote-status-server-badge">
            {ctrl.statusServerPort != null
              ? t('remote.statusServerRunning', { port: ctrl.statusServerPort })
              : t('remote.statusServerOff')}
          </span>
        </SectionHead>
        <div className={kit.toolbar}>
          <button
            type="button"
            className={`${kit.btn} ${kit.primary}`}
            disabled={ctrl.serverBusy || ctrl.statusServerPort != null}
            onClick={() => void ctrl.startServer(4732)}
            data-testid="remote-status-server-start"
          >
            {t('remote.statusServerStart')}
          </button>
          <button
            type="button"
            className={`${kit.btn} ${kit.ghost}`}
            disabled={ctrl.serverBusy || ctrl.statusServerPort == null}
            onClick={() => void ctrl.stopServer()}
            data-testid="remote-status-server-stop"
          >
            {t('remote.statusServerStop')}
          </button>
        </div>
        <p className={s.statusMsg}>{t('remote.statusServerHint')}</p>
      </Section>

      {/* Daemon hint */}
      <Section testId="remote-daemon-card">
        <SectionHead title={t('remote.daemonHintTitle')} hint={t('remote.daemonHintDesc')}>
          <button
            type="button"
            className={`${kit.btn} ${kit.outline}`}
            onClick={onCopyPreview}
            disabled={!ctrl.previewCmd}
            data-testid="remote-copy-preview"
          >
            {copyOk ? t('common.copied') : t('common.copy')}
          </button>
        </SectionHead>
        {ctrl.previewCmd ? (
          <pre className={s.codeBlock} data-testid="remote-preview-text">{ctrl.previewCmd}</pre>
        ) : ctrl.loading ? (
          <div className={kit.emptyBox}>
            <Spinner size={16} />
          </div>
        ) : (
          <div className={kit.emptyBox}>{t('remote.previewUnavailable')} —— {t('remote.previewUnavailableDesc')}</div>
        )}
      </Section>

      {/* Transport status */}
      <Section testId="remote-status-card">
        <SectionHead title={t('remote.transportStatus')} hint={t('remote.transportHint')}>
          <span className={kit.badge} data-fg={ctrl.status?.state === 'connected' || undefined}>
            {ctrl.status?.state ?? t('remote.unknown')}
          </span>
        </SectionHead>
        {ctrl.status?.message && (
          <p className={s.statusMsg}>{ctrl.status.message}</p>
        )}
      </Section>
    </PageShell>
  );
}