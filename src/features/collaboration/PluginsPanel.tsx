/**
 * PluginsPanel —— 插件管理面板。
 *
 * 此前 GUI 只能看到插件带来的 slash 命令,**装了什么、哪个加载失败、
 * 启用哪些、marketplace 有哪些全部不可见** —— 只能手改
 * `~/.reflect/config.toml` 的 `[plugins] enabled_plugins` 与
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
import { Package, FolderOpen, Trash2, Power } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Icon, Input, Select, Spinner } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { useAgentStore } from '@/stores/agentStore';
import {
  reflect_install_plugin,
  reflect_list_marketplaces,
  reflect_list_plugins,
  reflect_pick_workspace_folder,
  reflect_toggle_plugin,
  reflect_uninstall_plugin,
  type ReflectPluginScope,
} from '@/utils/commands';
import s from './CollaborationView.module.css';

const SCOPES: ReflectPluginScope[] = ['user', 'project', 'local', 'managed'];

export function PluginsPanel() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [showInstall, setShowInstall] = useState(false);
  const [path, setPath] = useState('');
  const [marketplace, setMarketplace] = useState('local');
  const [scope, setScope] = useState<ReflectPluginScope>('user');
  // 运行时**实际挂载**成功的插件(核心 `plugin_loaded` 事件)—— 与下面的
  // 「配置里装了哪些」是两件事。
  const loadedPlugins = useAgentStore((st) => st.loadedPlugins);

  const pluginsQ = useQuery({
    queryKey: ['plugins'],
    queryFn: () => reflect_list_plugins(),
    staleTime: 10_000,
  });
  const marketsQ = useQuery({
    queryKey: ['plugin-marketplaces'],
    queryFn: () => reflect_list_marketplaces(),
    staleTime: 60_000,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['plugins'] });
  };

  const toggleMut = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) =>
      reflect_toggle_plugin(v.id, v.enabled),
    onSuccess: invalidate,
  });
  const uninstallMut = useMutation({
    mutationFn: (v: { id: string; scope: ReflectPluginScope }) =>
      reflect_uninstall_plugin(v.id, v.scope),
    onSuccess: invalidate,
  });
  const installMut = useMutation({
    mutationFn: (v: { path: string; marketplace: string; scope: ReflectPluginScope }) =>
      reflect_install_plugin(v.path, v.marketplace, v.scope),
    onSuccess: invalidate,
  });

  const plugins = pluginsQ.data ?? [];
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
            disabled={installMut.isPending || !path.trim()}
            onClick={() =>
              void installMut.mutateAsync({ path: path.trim(), marketplace: marketplace.trim(), scope })
            }
            data-testid="plugin-install-submit"
          >
            {t('collaboration.pluginInstallSubmit')}
          </Button>
          {installMut.isError && (
            <p className={s.error} data-testid="plugin-install-error">
              {(installMut.error as Error).message}
            </p>
          )}
        </Card>
      )}

      {/* 运行时已挂载 —— 核心 `plugin_loaded` 事件驱动。配置里「启用了」
          不等于运行时真的挂上了(挂载失败/被 scope 过滤时不会到这)。 */}
      {loadedPlugins.length > 0 && (
        <ul className={s.serverList} data-testid="plugin-loaded-list">
          {loadedPlugins.map((p) => (
            <li key={p.plugin} className={s.serverRow}>
              <span className={s.serverName}>{p.plugin}</span>
              <span className={s.serverDetail}>
                {p.version || t('collaboration.pluginNoVersion')}
                {p.scope ? ` · ${p.scope}` : ''}
                {` · ${p.skillCount} skills · ${p.commandCount} cmds`}
              </span>
              <Badge variant="success">{t('collaboration.pluginLoaded')}</Badge>
            </li>
          ))}
        </ul>
      )}

      {pluginsQ.isLoading ? (        <div className={s.loading}>
          <Spinner size={18} />
        </div>
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
              <button
                type="button"
                className={s.actionBtn}
                onClick={() => void toggleMut.mutateAsync({ id: p.id, enabled: !p.enabled })}
                title={p.enabled ? t('collaboration.pluginDisable') : t('collaboration.pluginEnable')}
                data-testid={`plugin-toggle-${p.id}`}
              >
                <Icon icon={Power} size={12} />
              </button>
              <button
                type="button"
                className={s.actionBtn}
                onClick={() => void uninstallMut.mutateAsync({ id: p.id, scope: p.scope })}
                title={t('collaboration.pluginUninstall')}
                data-testid={`plugin-uninstall-${p.id}`}
              >
                <Icon icon={Trash2} size={12} />
              </button>
            </Card>
          ))}
        </div>
      )}

      {markets.length > 0 && (
        <div className={s.mcpCatalog} data-testid="plugin-marketplaces">
          {markets.map((m) => (
            <div key={m.name} className={s.mcpCatalogRow}>
              <div className={s.serverBody}>
                <div className={s.serverName}>{m.name}</div>
                <div className={s.serverDetail}>
                  {m.source} · {m.installLocation}
                </div>
              </div>
              {m.autoUpdate && <Badge variant="neutral">{t('collaboration.pluginAutoUpdate')}</Badge>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
