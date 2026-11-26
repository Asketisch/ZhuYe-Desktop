import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Store } from 'lucide-react';
import { Badge, Button, Icon, Spinner } from '@/features/harness/design-system';
import { useI18n } from '@/utils/i18n';
import { zhuye_browse_marketplace, zhuye_install_from_marketplace } from '@/utils/commands';
import { PLUGIN_COMMANDS_QUERY_KEY } from '@/logic/composer/usePluginCommands';
import { AGENTS_QUERY_KEY } from '@/logic/agents/useAgentsController';
import { pluginErrorMessage as errorMessage } from '@/logic/collaboration/usePluginsPanelController';
import s from '@/render/collaboration/CollaborationView.module.css';

export function MarketplaceRow({
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
    queryFn: () => zhuye_browse_marketplace(name),
    enabled: expanded,
    staleTime: 30_000,
  });
  const installMut = useMutation({
    mutationFn: (v: { marketplace: string; plugin: string }) =>
      zhuye_install_from_marketplace(v.marketplace, v.plugin),
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
