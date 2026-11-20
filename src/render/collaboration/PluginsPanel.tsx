import { Package, FolderOpen, Trash2, Power } from 'lucide-react';
import type { PluginsPanelProps, ZhuyePluginScope } from '@/contracts/pluginsPanel';
import { pluginErrorMessage } from './pluginErrorMessage';
import { Badge } from '../design-system/Badge';
import { Button } from '../design-system/Button';
import { Card } from '../design-system/Card';
import { EmptyState } from '../design-system/EmptyState';
import { Icon } from '../design-system/Icon';
import { Input } from '../design-system/Input';
import { Select } from '../design-system/Select';
import { Spinner } from '../design-system/Spinner';
import s from './CollaborationView.module.css';

const SCOPES: ZhuyePluginScope[] = ['user', 'project', 'local', 'managed'];

export function PluginsPanel({ t, ctrl, MarketplaceRow }: PluginsPanelProps) {
  const { showInstall, setShowInstall, path, setPath, marketplace, setMarketplace, scope, setScope,
    actionError, pluginsQuery: pluginsQ, marketsQuery: marketsQ, toggleMutation: toggleMut,
    uninstallMutation: uninstallMut, installMutation: installMut, plugins, markets, loadedPlugins,
    busy, browse } = ctrl;
  return (
    <div data-testid="collaboration-plugins-panel">
      <div className={s.sectionHeader}>
        <h3 className={s.sectionTitle}>
          <Icon icon={Package} size={14} />
          {t('collaboration.pluginsTitle')}
        </h3>
        {plugins.length > 0 && <Badge variant="neutral">{plugins.length}</Badge>}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowInstall((v) => !v)}
          data-testid="plugin-install-toggle"
        >
          <Icon icon={FolderOpen} size={12} /> {t('collaboration.pluginInstall')}
        </Button>
      </div>

      {showInstall && (
        <Card level="flat" padding="sm" className={s.mcpForm} data-testid="plugin-install-form">
          <div className={s.mcpFormRow}>
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder={t('collaboration.pluginPathPlaceholder')}
              aria-label={t('collaboration.pluginPath')}
              data-testid="plugin-path-input"
            />
            <Button size="sm" variant="ghost" onClick={() => void browse()} data-testid="plugin-browse">
              <Icon icon={FolderOpen} size={12} /> {t('collaboration.pluginBrowse')}
            </Button>
          </div>
          <div className={s.mcpFormRow}>
            <Input
              value={marketplace}
              onChange={(e) => setMarketplace(e.target.value)}
              placeholder={t('collaboration.pluginMarketplace')}
              aria-label={t('collaboration.pluginMarketplace')}
              data-testid="plugin-marketplace-input"
            />
            <Select
              value={scope}
              onChange={(e) => setScope(e.target.value as ZhuyePluginScope)}
              aria-label={t('collaboration.pluginScope')}
              data-testid="plugin-scope-select"
            >
              {SCOPES.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </Select>
          </div>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !path.trim()}
            onClick={() =>
              installMut.mutate({ path: path.trim(), marketplace: marketplace.trim(), scope })
            }
            data-testid="plugin-install-submit"
          >
            {t('collaboration.pluginInstallSubmit')}
          </Button>
          {installMut.isError && (
            <p className={s.errorText} role="alert" data-testid="plugin-install-error">
              {pluginErrorMessage(installMut.error)}
            </p>
          )}
        </Card>
      )}

      {actionError && (
        <p className={s.errorText} role="alert" data-testid="plugin-action-error">
          {actionError}
        </p>
      )}

      {/* 运行时快照只包含当前会话加载成功的插件。 */}
      {loadedPlugins.length > 0 && (
        <ul className={s.serverList} data-testid="plugin-loaded-list">
          {loadedPlugins.map((p) => (
            <li key={p.plugin} className={s.serverRow}>
              <span className={s.serverName}>{p.plugin}</span>
              <span className={s.serverDetail}>
                {p.version || t('collaboration.pluginNoVersion')}
                {p.scope ? ` · ${p.scope}` : ''}
                {` · ${p.skill_count} skills · ${p.command_count} cmds`}
              </span>
              <Badge variant="success">{t('collaboration.pluginLoaded')}</Badge>
            </li>
          ))}
        </ul>
      )}

      {pluginsQ.isLoading ? (        <div className={s.loading}>
          <Spinner size={18} />
        </div>
      ) : pluginsQ.isError ? (
        <p className={s.errorText} role="alert">{pluginErrorMessage(pluginsQ.error)}</p>
      ) : plugins.length === 0 ? (
        <Card level="flat" padding="none">
          <EmptyState
            size="sm"
            icon={<Icon icon={Package} />}
            title={t('collaboration.pluginsEmpty')}
            description={t('collaboration.pluginsEmptyHint')}
          />
        </Card>
      ) : (
        <div className={s.serverList} data-testid="plugin-list">
          {plugins.map((p) => (
            <Card key={`${p.id}-${p.scope}`} level="outlined" padding="sm" className={s.serverRow}>
              <div className={s.serverBody}>
                <div className={s.serverName}>{p.id}</div>
                <div className={s.serverDetail}>
                  {p.version} · {p.scope} · {p.installPath}
                </div>
              </div>
              <Badge variant={p.enabled ? 'success' : 'neutral'}>
                {p.enabled ? t('collaboration.pluginEnabled') : t('collaboration.pluginDisabled')}
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => toggleMut.mutate({ id: p.id, enabled: !p.enabled })}
                title={p.enabled ? t('collaboration.pluginDisable') : t('collaboration.pluginEnable')}
                aria-label={p.enabled ? t('collaboration.pluginDisable') : t('collaboration.pluginEnable')}
                data-testid={`plugin-toggle-${p.id}`}
              >
                <Icon icon={Power} size={12} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => uninstallMut.mutate({ id: p.id, scope: p.scope })}
                title={t('collaboration.pluginUninstall')}
                aria-label={t('collaboration.pluginUninstall')}
                data-testid={`plugin-uninstall-${p.id}`}
              >
                <Icon icon={Trash2} size={12} />
              </Button>
            </Card>
          ))}
        </div>
      )}

      {marketsQ.isError && <p className={s.errorText} role="alert">{pluginErrorMessage(marketsQ.error)}</p>}
      {markets.length > 0 && (
        <div className={s.mcpCatalog} data-testid="plugin-marketplaces">
          {markets.map((m) => (
            <MarketplaceRow key={m.name} name={m.name} source={m.source} location={m.installLocation} autoUpdate={m.autoUpdate} />
          ))}
        </div>
      )}
    </div>
  );
}
