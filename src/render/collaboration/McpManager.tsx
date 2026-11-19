import { Plus, Server, Trash2, Library, Boxes } from 'lucide-react';
import type { McpManagerProps, McpServerEntry } from '@/contracts/mcpManager';
import { Badge } from '../design-system/Badge';
import { Button } from '../design-system/Button';
import { Card } from '../design-system/Card';
import { EmptyState } from '../design-system/EmptyState';
import { Icon } from '../design-system/Icon';
import { Input } from '../design-system/Input';
import { Select } from '../design-system/Select';
import { Spinner } from '../design-system/Spinner';
import s from './CollaborationView.module.css';

const MCP_TRANSPORTS: McpServerEntry['type'][] = ['stdio', 'http', 'sse'];
function errorMessage(error: unknown): string { if (error instanceof Error) return error.message; if (error && typeof error === 'object' && 'msg' in error && typeof error.msg === 'string') return error.msg; return String(error); }

export function McpManager({ t, ctrl }: McpManagerProps) {
  const { runtime, showForm, setShowForm,
    showCatalog, setShowCatalog, showPrimitives, setShowPrimitives, name, setName, transport, setTransport,
    command, setCommand, argsText, setArgsText, url, setUrl, argsError, setArgsError,
    serversQuery: serversQ, catalogQuery: catalogQ, resourcesQuery: resourcesQ, promptsQuery: promptsQ,
    upsertMutation: upsertMut, deleteMutation: deleteMut, resources, prompts, servers, catalog,
    busy, submit, addFromCatalog } = ctrl;
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
          {resourcesQ.isLoading ? <Spinner size={16} /> : resourcesQ.isError ? (
            <p className={s.errorText} role="alert">{errorMessage(resourcesQ.error)}</p>
          ) : resources.length === 0 ? (
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
          {promptsQ.isLoading ? <Spinner size={16} /> : promptsQ.isError ? (
            <p className={s.errorText} role="alert">{errorMessage(promptsQ.error)}</p>
          ) : prompts.length === 0 ? (
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
              onChange={(e) => { setTransport(e.target.value as McpServerEntry['type']); setArgsError(false); }}
              aria-label={t('collaboration.mcpTransport')}
              data-testid="mcp-transport-select"
            >
              {MCP_TRANSPORTS.map((x) => (
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
                onChange={(e) => { setArgsText(e.target.value); setArgsError(false); }}
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
          {transport === 'stdio' && <p className={s.hint}>{t('collaboration.mcpArgsHint')}</p>}
          <Button
            size="sm"
            variant="primary"
            onClick={() => void submit()}
            disabled={busy || !name.trim()}
            data-testid="mcp-add-submit"
          >
            {t('collaboration.mcpAddSubmit')}
          </Button>
          {argsError && <p className={s.errorText} role="alert">{t('collaboration.mcpArgsUnclosedQuote')}</p>}
          {upsertMut.isError && (
            <p className={s.errorText} role="alert" data-testid="mcp-add-error">
              {errorMessage(upsertMut.error)}
            </p>
          )}
        </Card>
      )}

      {showCatalog && (
        <Card level="flat" padding="sm" className={s.mcpCatalog} data-testid="mcp-catalog">
          {catalogQ.isLoading ? (
            <Spinner size={16} />
          ) : catalogQ.isError ? (
            <p className={s.errorText} role="alert">{errorMessage(catalogQ.error)}</p>
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
                      disabled={busy}
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

      {!showForm && upsertMut.isError && (
        <p className={s.errorText} role="alert">{errorMessage(upsertMut.error)}</p>
      )}
      {deleteMut.isError && <p className={s.errorText} role="alert">{errorMessage(deleteMut.error)}</p>}

      {serversQ.isLoading ? (
        <div className={s.loading}>
          <Spinner size={18} />
        </div>
      ) : serversQ.isError ? (
        <p className={s.errorText} role="alert">{errorMessage(serversQ.error)}</p>
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
            const failed = !m.running && rt?.status === 'failed';
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
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => deleteMut.mutate(m.name)}
                  title={t('collaboration.mcpRemove')}
                  aria-label={t('collaboration.mcpRemove')}
                  data-testid={`mcp-delete-${m.name}`}
                >
                  <Icon icon={Trash2} size={12} />
                </Button>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
