/**
 * McpManager —— MCP 服务管理面板。
 *
 * MCP 是基座最主要的扩展机制,此前 GUI 只能观测,加服务得手改
 * `config.toml` 的 `[mcp_servers.<name>]` —— 没有任何自助路径。
 *
 * 本面板提供:
 * - **已配置的服务**:名字 / transport / 启动命令 / 运行状态 + 删除;
 * - **新增**:stdio(command + args)或 http/sse(url);
 * - **精选 catalog**:核心内置的离线清单 + 安装提示,一键加入配置。
 *
 * 写路径经后端统一落盘 + 运行时起停(`reflect_upsert_mcp_server`),语义与
 * 启动时的 `bootstrap_mcp` 一致。
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Server, Trash2, Library, Boxes } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Icon, Input, Select, Spinner } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import { useAgentStore } from '@/stores/agentStore';
import {
  reflect_delete_mcp_server,
  reflect_list_mcp_prompts,
  reflect_list_mcp_resources,
  reflect_list_mcp_servers,
  reflect_mcp_catalog,
  reflect_upsert_mcp_server,
  type McpServerEntry,
} from '@/utils/commands/mcp';
import s from './CollaborationView.module.css';

const TRANSPORTS: McpServerEntry['type'][] = ['stdio', 'http', 'sse'];

export function McpManager() {
  const { t } = useI18n();
  const qc = useQueryClient();
  // 运行时事件(启动 / 失败)来自 store —— 与配置列表互补。
  const runtime = useAgentStore((st) => st.mcpServers);

  const serversQ = useQuery({
    queryKey: ['mcp-servers'],
    queryFn: () => reflect_list_mcp_servers(),
    staleTime: 10_000,
  });
  const catalogQ = useQuery({
    queryKey: ['mcp-catalog'],
    queryFn: () => reflect_mcp_catalog(),
    staleTime: 300_000,
  });

  const [showForm, setShowForm] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<McpServerEntry['type']>('stdio');
  const [command, setCommand] = useState('');
  const [argsText, setArgsText] = useState('');
  const [url, setUrl] = useState('');

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['mcp-servers'] });
  };

  const upsertMut = useMutation({
    mutationFn: (v: { name: string; entry: McpServerEntry }) =>
      reflect_upsert_mcp_server(v.name, v.entry),
    onSuccess: invalidate,
  });
  const deleteMut = useMutation({
    mutationFn: (name: string) => reflect_delete_mcp_server(name),
    onSuccess: invalidate,
  });

  const servers = serversQ.data ?? [];
  const catalog = catalogQ.data ?? [];

  // MCP 三大原语:tools 可达(agent 侧),resources / prompts 此前只有
  // LLM 能用 —— 用户想复用某个 server 的资源或 prompt 模板时没有路径。
  const [showPrimitives, setShowPrimitives] = useState(false);
  const resourcesQ = useQuery({
    queryKey: ['mcp-resources'],
    queryFn: () => reflect_list_mcp_resources(),
    enabled: showPrimitives,
    staleTime: 30_000,
  });
  const promptsQ = useQuery({
    queryKey: ['mcp-prompts'],
    queryFn: () => reflect_list_mcp_prompts(),
    enabled: showPrimitives,
    staleTime: 30_000,
  });
  const resources = resourcesQ.data ?? [];
  const prompts = promptsQ.data ?? [];

  const submit = async () => {
    const serverName = name.trim();
    if (!serverName) return;
    const entry: McpServerEntry = {
      type: transport,
      command: transport === 'stdio' ? command.trim() : null,
      args:
        transport === 'stdio'
          ? argsText
              .split(/\s+/)
              .map((a) => a.trim())
              .filter(Boolean)
          : null,
      url: transport === 'stdio' ? null : url.trim(),
    };
    try {
      await upsertMut.mutateAsync({ name: serverName, entry });
      setName('');
      setCommand('');
      setArgsText('');
      setUrl('');
      setShowForm(false);
    } catch {
      /* 错误由 mutation 状态呈现 */
    }
  };

  const addFromCatalog = async (entryId: string) => {
    const c = catalog.find((x) => x.id === entryId);
    if (!c) return;
    try {
      await upsertMut.mutateAsync({
        name: c.id,
        entry: {
          type: 'stdio',
          command: c.command,
          args: c.args,
        },
      });
    } catch {
      /* 错误由 mutation 状态呈现 */
    }
  };

  return (
    <div data-testid="collaboration-mcp-manager">
      <div className={s.sectionHeader}>
        <h3 className={s.sectionTitle}>
          <Icon icon={Server} size={14} />
          {t('collaboration.mcpTitle')}
        </h3>
        {servers.length > 0 && <Badge variant="neutral">{servers.length}</Badge>}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowForm((v) => !v)}
          data-testid="mcp-add-toggle"
        >
          <Icon icon={Plus} size={12} /> {t('collaboration.mcpAdd')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowCatalog((v) => !v)}
          data-testid="mcp-catalog-toggle"
        >
          <Icon icon={Library} size={12} /> {t('collaboration.mcpCatalog')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowPrimitives((v) => !v)}
          data-testid="mcp-primitives-toggle"
        >
          <Icon icon={Boxes} size={12} /> {t('collaboration.mcpPrimitives')}
        </Button>
      </div>

      {showPrimitives && (
        <Card level="flat" padding="sm" className={s.mcpCatalog} data-testid="mcp-primitives">
          <div className={s.mcpFormRow}>
            <span className={s.detailLabel}>{t('collaboration.mcpResources')}</span>
            <Badge variant="neutral">{resources.length}</Badge>
          </div>
          {resources.length === 0 ? (
            <p className={s.hint}>{t('collaboration.mcpResourcesEmpty')}</p>
          ) : (
            resources.map((r) => (
              <div key={`${r.server}:${r.uri}`} className={s.mcpCatalogRow}>
                <div className={s.serverBody}>
                  <div className={s.serverName}>{r.name}</div>
                  <div className={s.serverDetail}>
                    {r.server} · <code className={s.codeInline}>{r.uri}</code>
                  </div>
                </div>
                {r.mimeType && <Badge variant="neutral">{r.mimeType}</Badge>}
              </div>
            ))
          )}
          <div className={s.mcpFormRow}>
            <span className={s.detailLabel}>{t('collaboration.mcpPrompts')}</span>
            <Badge variant="neutral">{prompts.length}</Badge>
          </div>
          {prompts.length === 0 ? (
            <p className={s.hint}>{t('collaboration.mcpPromptsEmpty')}</p>
          ) : (
            prompts.map((p) => (
              <div key={`${p.server}:${p.name}`} className={s.mcpCatalogRow}>
                <div className={s.serverBody}>
                  <div className={s.serverName}>{p.name}</div>
                  <div className={s.serverDetail}>
                    {p.server}
                    {p.description ? ` · ${p.description}` : ''}
                  </div>
                </div>
                {p.arguments.length > 0 && (
                  <Badge variant="neutral">{p.arguments.join(', ')}</Badge>
                )}
              </div>
            ))
          )}
        </Card>
      )}

      {showForm && (
        <Card level="flat" padding="sm" className={s.mcpForm} data-testid="mcp-add-form">
          <div className={s.mcpFormRow}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('collaboration.mcpNamePlaceholder')}
              aria-label={t('collaboration.mcpName')}
              data-testid="mcp-name-input"
            />
            <Select
              value={transport}
              onChange={(e) => setTransport(e.target.value as McpServerEntry['type'])}
              aria-label={t('collaboration.mcpTransport')}
              data-testid="mcp-transport-select"
            >
              {TRANSPORTS.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </Select>
          </div>
          {transport === 'stdio' ? (
            <div className={s.mcpFormRow}>
              <Input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder={t('collaboration.mcpCommandPlaceholder')}
                aria-label={t('collaboration.mcpCommand')}
                data-testid="mcp-command-input"
              />
              <Input
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
                placeholder={t('collaboration.mcpArgsPlaceholder')}
                aria-label={t('collaboration.mcpArgs')}
                data-testid="mcp-args-input"
              />
            </div>
          ) : (
            <div className={s.mcpFormRow}>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t('collaboration.mcpUrlPlaceholder')}
                aria-label={t('collaboration.mcpUrl')}
                data-testid="mcp-url-input"
              />
            </div>
          )}
          <Button
            size="sm"
            variant="primary"
            onClick={() => void submit()}
            disabled={upsertMut.isPending || !name.trim()}
            data-testid="mcp-add-submit"
          >
            {t('collaboration.mcpAddSubmit')}
          </Button>
          {upsertMut.isError && (
            <p className={s.error} data-testid="mcp-add-error">
              {(upsertMut.error as Error).message}
            </p>
          )}
        </Card>
      )}

      {showCatalog && (
        <Card level="flat" padding="sm" className={s.mcpCatalog} data-testid="mcp-catalog">
          {catalogQ.isLoading ? (
            <Spinner size={16} />
          ) : catalog.length === 0 ? (
            <p className={s.hint}>{t('collaboration.mcpCatalogEmpty')}</p>
          ) : (
            catalog.map((c) => {
              const installed = servers.some((x) => x.name === c.id);
              return (
                <div key={c.id} className={s.mcpCatalogRow}>
                  <div className={s.serverBody}>
                    <div className={s.serverName}>{c.name}</div>
                    <div className={s.serverDetail}>{c.description}</div>
                    <code className={s.codeInline}>{c.installHint}</code>
                  </div>
                  {installed ? (
                    <Badge variant="success">{t('collaboration.mcpInstalled')}</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void addFromCatalog(c.id)}
                      disabled={upsertMut.isPending}
                      data-testid={`mcp-catalog-add-${c.id}`}
                    >
                      {t('collaboration.mcpAddSubmit')}
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </Card>
      )}

      {serversQ.isLoading ? (
        <div className={s.loading}>
          <Spinner size={18} />
        </div>
      ) : servers.length === 0 ? (
        <Card level="flat" padding="none">
          <EmptyState
            size="sm"
            icon={<Icon icon={Server} />}
            title={t('collaboration.mcpEmpty')}
            description={t('collaboration.mcpEmptyHint')}
          />
        </Card>
      ) : (
        <div className={s.serverList} data-testid="mcp-server-list">
          {servers.map((m) => {
            const rt = runtime.find((r) => r.name === m.name);
            const failed = rt?.status === 'failed';
            return (
              <Card
                key={m.name}
                level="outlined"
                padding="sm"
                className={s.serverRow}
                data-status={failed ? 'failed' : m.running ? 'started' : 'stopped'}
              >
                <span
                  className={s.statusDot}
                  data-status={failed ? 'failed' : m.running ? 'started' : 'stopped'}
                />
                <div className={s.serverBody}>
                  <div className={s.serverName}>{m.name}</div>
                  <div className={s.serverDetail}>
                    {m.transport}
                    {m.command ? ` · ${m.command} ${m.args.join(' ')}`.trimEnd() : ''}
                    {m.url ? ` · ${m.url}` : ''}
                  </div>
                  {failed && rt?.detail && <div className={s.serverDetail}>{rt.detail}</div>}
                </div>
                <Badge variant={failed ? 'danger' : m.running ? 'success' : 'neutral'}>
                  {failed ? 'failed' : m.running ? 'started' : 'stopped'}
                </Badge>
                <button
                  type="button"
                  className={s.actionBtn}
                  onClick={() => void deleteMut.mutateAsync(m.name)}
                  title={t('collaboration.mcpRemove')}
                  data-testid={`mcp-delete-${m.name}`}
                >
                  <Icon icon={Trash2} size={12} />
                </button>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
