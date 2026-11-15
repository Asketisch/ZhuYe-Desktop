/**
 * PluginsPanel —— 插件管理面板。
 *
 * 此前 GUI 只能看到插件带来的 slash 命令,**装了什么、哪个加载失败、
 * 启用哪些、marketplace 有哪些全部不可见** —— 只能手改
 * `~/.zhuye/config.toml` 的 `[plugins] enabled_plugins` 与
 * `installed_plugins.json`。
 *
 * 面板提供:
 * - **已安装插件**:id / 版本 / scope / 安装路径 + 启停开关 + 卸载;
 * - **已知 marketplace**:名字 / 源类型 / 安装位置;
 * - **本地安装**:选目录(插件根目录含 `plugin.toml` 或
 *   `.claude-plugin/plugin.json`)+ marketplace + scope。
 *
 * 启停走后端:改 config → 落盘 → 核心 `reload_plugins` diff 同步
 * (挂/卸插件,不打断运行中的会话)。
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, FolderOpen, Trash2, Power, Store } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Icon, Input, Select, Spinner } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import {
  reflect_browse_marketplace,
  reflect_install_from_marketplace,
  reflect_install_plugin,
  reflect_list_marketplaces,
  reflect_list_plugins,
  reflect_pick_workspace_folder,
  reflect_toggle_plugin,
  reflect_uninstall_plugin,
  type ReflectPluginScope,
} from '@/utils/commands';
import { PLUGIN_COMMANDS_QUERY_KEY } from '@/features/composer/usePluginCommands';
import { AGENTS_QUERY_KEY } from '@/features/agents/useAgentsController';
import s from './CollaborationView.module.css';

const SCOPES: ReflectPluginScope[] = ['user', 'project', 'local', 'managed'];

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'msg' in error && typeof error.msg === 'string') return error.msg;
  return String(error);
}

export function PluginsPanel() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [showInstall, setShowInstall] = useState(false);
  const [path, setPath] = useState('');
  const [marketplace, setMarketplace] = useState('local');
  const [scope, setScope] = useState<ReflectPluginScope>('user');
  const [actionError, setActionError] = useState<string | null>(null);
  const pluginsQ = useQuery({
    queryKey: ['plugins'],
    queryFn: () => reflect_list_plugins(),
    staleTime: 10_000,
    refetchInterval: 5_000,
  });
  const marketsQ = useQuery({
    queryKey: ['plugin-marketplaces'],
    queryFn: () => reflect_list_marketplaces(),
    staleTime: 60_000,
  });

  // 插件挂载是热的:slash 命令 / 技能 / MCP server / agent 定义都随
  // enabled 列表 diff 同步。只刷已装列表会让用户「装了却在其它面板
  // 看不到」,所以四个消费面一起失效。
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['plugins'] });
    void qc.invalidateQueries({ queryKey: PLUGIN_COMMANDS_QUERY_KEY });
    void qc.invalidateQueries({ queryKey: ['skills'] });
    void qc.invalidateQueries({ queryKey: ['mcp-servers'] });
    void qc.invalidateQueries({ queryKey: AGENTS_QUERY_KEY });
  };

  const toggleMut = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) =>
      reflect_toggle_plugin(v.id, v.enabled),
    onMutate: () => setActionError(null),
    onError: (error) => setActionError(errorMessage(error)),
    onSettled: invalidate,
  });
  const uninstallMut = useMutation({
    mutationFn: (v: { id: string; scope: ReflectPluginScope }) =>
      reflect_uninstall_plugin(v.id, v.scope),
    onMutate: () => setActionError(null),
    onError: (error) => setActionError(errorMessage(error)),
    onSettled: invalidate,
  });
  const installMut = useMutation({
    mutationFn: (v: { path: string; marketplace: string; scope: ReflectPluginScope }) =>
      reflect_install_plugin(v.path, v.marketplace, v.scope),
    onSettled: invalidate,
  });
  const busy = toggleMut.isPending || uninstallMut.isPending || installMut.isPending;

  const plugins = pluginsQ.data ?? [];
  const loadedPlugins = pluginsQ.isError ? [] : plugins.flatMap((plugin) => plugin.runtime ? [plugin.runtime] : []);
  const markets = marketsQ.data ?? [];

  const browse = async () => {
    try {
      const picked = await reflect_pick_workspace_folder();
      if (picked) setPath(picked);
    } catch {
      /* 取消或不可用 —— 保持手填 */
    }
  };

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
              onChange={(e) => setScope(e.target.value as ReflectPluginScope)}
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
              {errorMessage(installMut.error)}
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
        <p className={s.errorText} role="alert">{errorMessage(pluginsQ.error)}</p>
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

      {marketsQ.isError && <p className={s.errorText} role="alert">{errorMessage(marketsQ.error)}</p>}
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

/**
 * v1.11 桌面#2:单个 marketplace 行 + 展开浏览其可安装插件清单。
 *
 * 展开时 `reflect_browse_marketplace` 拉取该市场 manifest 的插件列表;
 * 每行「安装」走 `reflect_install_from_marketplace`(含依赖解析)。
 * 安装成功后刷新已装列表;未注册 / 缓存缺失的错误在行内显性展示。
 */
function MarketplaceRow({
  name,
  source,
  location,
  autoUpdate,
}: {
  name: string;
  source: string;
  location: string;
  autoUpdate: boolean;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const browseQ = useQuery({
    queryKey: ['marketplace-plugins', name],
    queryFn: () => reflect_browse_marketplace(name),
    enabled: expanded,
    staleTime: 30_000,
  });
  const installMut = useMutation({
    mutationFn: (v: { marketplace: string; plugin: string }) =>
      reflect_install_from_marketplace(v.marketplace, v.plugin),
    onMutate: () => setInstallError(null),
    onError: (error) => setInstallError(errorMessage(error)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['plugins'] });
      void qc.invalidateQueries({ queryKey: ['marketplace-plugins', name] });
      // 市场一键安装后能力立刻挂载,slash / 技能 / MCP / agent 列表同步失效。
      void qc.invalidateQueries({ queryKey: PLUGIN_COMMANDS_QUERY_KEY });
      void qc.invalidateQueries({ queryKey: ['skills'] });
      void qc.invalidateQueries({ queryKey: ['mcp-servers'] });
      void qc.invalidateQueries({ queryKey: AGENTS_QUERY_KEY });
    },
  });

  return (
    <div className={s.mcpCatalogRow} data-testid={`marketplace-row-${name}`}>
      <div className={s.serverBody}>
        <div className={s.serverName}>
          <Icon icon={Store} size={12} /> {name}
        </div>
        <div className={s.serverDetail}>
          {source} · {location}
        </div>
      </div>
      {autoUpdate && <Badge variant="neutral">{t('collaboration.pluginAutoUpdate')}</Badge>}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        data-testid={`marketplace-browse-${name}`}
      >
        {expanded ? t('collaboration.marketCollapse') : t('collaboration.marketBrowse')}
      </Button>
      {expanded && (
        <div className={s.mcpCatalog} data-testid={`marketplace-plugins-${name}`}>
          {browseQ.isLoading ? (
            <div className={s.loading}><Spinner size={16} /></div>
          ) : browseQ.isError ? (
            <p className={s.errorText} role="alert">{errorMessage(browseQ.error)}</p>
          ) : (browseQ.data ?? []).length === 0 ? (
            <p className={s.serverDetail}>{t('collaboration.marketEmpty')}</p>
          ) : (
            (browseQ.data ?? []).map((p) => (
              <div key={p.name} className={s.mcpCatalogRow} data-testid={`market-plugin-${p.name}`}>
                <div className={s.serverBody}>
                  <div className={s.serverName}>
                    {p.name}
                    {p.version && <span className={s.serverDetail}> · {p.version}</span>}
                  </div>
                  {p.description && <div className={s.serverDetail}>{p.description}</div>}
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={installMut.isPending}
                  onClick={() => installMut.mutate({ marketplace: name, plugin: p.name })}
                  data-testid={`market-install-${p.name}`}
                >
                  {t('collaboration.marketInstall')}
                </Button>
              </div>
            ))
          )}
          {installError && (
            <p className={s.errorText} role="alert" data-testid="market-install-error">
              {installError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
