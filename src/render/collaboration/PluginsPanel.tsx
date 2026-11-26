import { FolderOpen, Package, Power, Trash2 } from 'lucide-react';
import type { PluginsPanelProps, ZhuyePluginScope } from '@/contracts/orchestration/pluginsPanel';
import { pluginErrorMessage } from './pluginErrorMessage';
import { Spinner } from '../design-system/Spinner';
import kit from '../settings/SettingsPage.module.css';

const SCOPES: ZhuyePluginScope[] = ['user', 'project', 'local', 'managed'];

/**
 * PluginsPanel —— 插件分区（纯展示）。
 *
 * 视觉走设置页套件（SettingsPage.module.css）：分组头 + 圆角行容器 +
 * 图标瓦片，徽标 / 按钮统一套件形态。测试锚点（plugin-*）全部保留。
 */
export function PluginsPanel({ t, ctrl, MarketplaceRow }: PluginsPanelProps) {
  const { showInstall, setShowInstall, path, setPath, marketplace, setMarketplace, scope, setScope,
    actionError, pluginsQuery: pluginsQ, marketsQuery: marketsQ, toggleMutation: toggleMut,
    uninstallMutation: uninstallMut, installMutation: installMut, plugins, markets, loadedPlugins,
    busy, browse } = ctrl;
  return (
    <div data-testid="collaboration-plugins-panel">
      <div className={kit.resHead}>
        <h3><Package size={14} strokeWidth={1.5} aria-hidden /> {t('collaboration.pluginsTitle')}</h3>
        {plugins.length > 0 && <span className={kit.count}>{plugins.length}</span>}
        <div className={kit.actions}>
          <button
            type="button"
            className={kit.btn}
            onClick={() => setShowInstall((v) => !v)}
            data-testid="plugin-install-toggle"
          >
            <FolderOpen size={12} strokeWidth={1.5} aria-hidden /> {t('collaboration.pluginInstall')}
          </button>
        </div>
      </div>

      {showInstall && (
        <div className={kit.resGroup} data-testid="plugin-install-form">
          <div className={kit.toolbar}>
            <input
              className={kit.input}
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder={t('collaboration.pluginPathPlaceholder')}
              aria-label={t('collaboration.pluginPath')}
              data-testid="plugin-path-input"
              style={{ flex: 1, minWidth: 0 }}
            />
            <button type="button" className={kit.btn} onClick={() => void browse()} data-testid="plugin-browse">
              <FolderOpen size={12} strokeWidth={1.5} aria-hidden /> {t('collaboration.pluginBrowse')}
            </button>
          </div>
          <div className={kit.toolbar}>
            <input
              className={kit.input}
              value={marketplace}
              onChange={(e) => setMarketplace(e.target.value)}
              placeholder={t('collaboration.pluginMarketplace')}
              aria-label={t('collaboration.pluginMarketplace')}
              data-testid="plugin-marketplace-input"
              style={{ flex: 1, minWidth: 0 }}
            />
            <span className={kit.selectWrap}>
              <select
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
              </select>
            </span>
          </div>
          <button
            type="button"
            className={`${kit.btn} ${kit.primary}`}
            disabled={busy || !path.trim()}
            onClick={() =>
              installMut.mutate({ path: path.trim(), marketplace: marketplace.trim(), scope })
            }
            data-testid="plugin-install-submit"
          >
            {t('collaboration.pluginInstallSubmit')}
          </button>
          {installMut.isError && (
            <div className={kit.notice} role="alert" data-testid="plugin-install-error">
              <span>{pluginErrorMessage(installMut.error)}</span>
            </div>
          )}
        </div>
      )}

      {actionError && (
        <div className={kit.notice} role="alert" data-testid="plugin-action-error">
          <span>{actionError}</span>
        </div>
      )}

      {/* 运行时快照只包含当前会话加载成功的插件。 */}
      {loadedPlugins.length > 0 && (
        <div className={kit.resList} data-testid="plugin-loaded-list">
          {loadedPlugins.map((p) => (
            <div key={p.plugin} className={kit.resItem}>
              <span className={kit.iconTile}><Package strokeWidth={1.5} aria-hidden /></span>
              <div className={kit.resMain}>
                <div className={kit.resTitle}>{p.plugin}</div>
                <div className={kit.resDesc}>
                  {p.version || t('collaboration.pluginNoVersion')}
                  {p.scope ? ` · ${p.scope}` : ''}
                  {` · ${p.skill_count} skills · ${p.command_count} cmds`}
                </div>
              </div>
              <div className={kit.resSide}>
                <span className={kit.badge} data-fg>{t('collaboration.pluginLoaded')}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {pluginsQ.isLoading ? (
        <div className={kit.emptyBox}><Spinner size={18} /></div>
      ) : pluginsQ.isError ? (
        <div className={kit.notice} role="alert"><span>{pluginErrorMessage(pluginsQ.error)}</span></div>
      ) : plugins.length === 0 ? (
        <div className={kit.emptyBox}>{t('collaboration.pluginsEmpty')} —— {t('collaboration.pluginsEmptyHint')}</div>
      ) : (
        <div className={kit.resList} data-testid="plugin-list">
          {plugins.map((p) => (
            <div key={`${p.id}-${p.scope}`} className={kit.resItem}>
              <span className={kit.iconTile}><Package strokeWidth={1.5} aria-hidden /></span>
              <div className={kit.resMain}>
                <div className={kit.resTitle}>{p.id}</div>
                <div className={kit.resDesc}>
                  {p.version} · {p.scope} · {p.installPath}
                </div>
              </div>
              <div className={kit.resSide}>
                <span className={kit.badge} data-fg={p.enabled || undefined}>
                  {p.enabled ? t('collaboration.pluginEnabled') : t('collaboration.pluginDisabled')}
                </span>
                <button
                  type="button"
                  className={`${kit.btn} ${kit.ghost} ${kit.iconOnly}`}
                  disabled={busy}
                  onClick={() => toggleMut.mutate({ id: p.id, enabled: !p.enabled })}
                  title={p.enabled ? t('collaboration.pluginDisable') : t('collaboration.pluginEnable')}
                  aria-label={p.enabled ? t('collaboration.pluginDisable') : t('collaboration.pluginEnable')}
                  data-testid={`plugin-toggle-${p.id}`}
                >
                  <Power strokeWidth={1.5} aria-hidden />
                </button>
                <button
                  type="button"
                  className={`${kit.btn} ${kit.ghost} ${kit.iconOnly}`}
                  disabled={busy}
                  onClick={() => uninstallMut.mutate({ id: p.id, scope: p.scope })}
                  title={t('collaboration.pluginUninstall')}
                  aria-label={t('collaboration.pluginUninstall')}
                  data-testid={`plugin-uninstall-${p.id}`}
                >
                  <Trash2 strokeWidth={1.5} aria-hidden />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {marketsQ.isError && <div className={kit.notice} role="alert"><span>{pluginErrorMessage(marketsQ.error)}</span></div>}
      {markets.length > 0 && (
        <div className={kit.resGroup} data-testid="plugin-marketplaces">
          {markets.map((m) => (
            <MarketplaceRow key={m.name} name={m.name} source={m.source} location={m.installLocation} autoUpdate={m.autoUpdate} />
          ))}
        </div>
      )}
    </div>
  );
}
