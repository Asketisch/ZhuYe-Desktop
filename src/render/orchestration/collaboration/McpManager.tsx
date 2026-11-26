import { Boxes, Library, Plus, Server, Trash2 } from 'lucide-react';
import type { McpManagerProps, McpServerEntry } from '@/contracts/orchestration/mcpManager';
import { Spinner } from '@/render/harness/design-system/Spinner';
import kit from '@/render/harness/settings/SettingsPage.module.css';

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
      <div className={kit.resHead}>
        <h3><Server size={14} strokeWidth={1.5} aria-hidden /> {t('collaboration.mcpTitle')}</h3>
        {servers.length > 0 && <span className={kit.count}>{servers.length}</span>}
        <div className={`${kit.actions} ${kit.sideWrap}`}>
          <button type="button" className={kit.btn} onClick={() => setShowForm((v) => !v)} data-testid="mcp-add-toggle">
            <Plus size={12} strokeWidth={1.5} aria-hidden /> {t('collaboration.mcpAdd')}
          </button>
          <button type="button" className={kit.btn} onClick={() => setShowCatalog((v) => !v)} data-testid="mcp-catalog-toggle">
            <Library size={12} strokeWidth={1.5} aria-hidden /> {t('collaboration.mcpCatalog')}
          </button>
          <button type="button" className={kit.btn} onClick={() => setShowPrimitives((v) => !v)} data-testid="mcp-primitives-toggle">
            <Boxes size={12} strokeWidth={1.5} aria-hidden /> {t('collaboration.mcpPrimitives')}
          </button>
        </div>
      </div>

      {showPrimitives && (
        <div className={kit.resGroup} data-testid="mcp-primitives">
          <div className={kit.resHead}>
            <h3>{t('collaboration.mcpResources')}</h3>
            <span className={kit.count}>{resources.length}</span>
          </div>
          {resourcesQ.isLoading ? <Spinner size={16} /> : resourcesQ.isError ? (
            <div className={kit.notice} role="alert"><span>{errorMessage(resourcesQ.error)}</span></div>
          ) : resources.length === 0 ? (
            <div className={kit.emptyBox}>{t('collaboration.mcpResourcesEmpty')}</div>
          ) : (
            <div className={kit.resList}>
              {resources.map((r) => (
                <div key={`${r.server}:${r.uri}`} className={kit.resItem}>
                  <span className={kit.iconTile}><Server strokeWidth={1.5} aria-hidden /></span>
                  <div className={kit.resMain}>
                    <div className={kit.resTitle}>{r.name}</div>
                    <div className={kit.resDesc}>{r.server} · <code className={kit.mono}>{r.uri}</code></div>
                  </div>
                  {r.mimeType && <div className={kit.resSide}><span className={kit.badge}>{r.mimeType}</span></div>}
                </div>
              ))}
            </div>
          )}
          <div className={kit.resHead}>
            <h3>{t('collaboration.mcpPrompts')}</h3>
            <span className={kit.count}>{prompts.length}</span>
          </div>
          {promptsQ.isLoading ? <Spinner size={16} /> : promptsQ.isError ? (
            <div className={kit.notice} role="alert"><span>{errorMessage(promptsQ.error)}</span></div>
          ) : prompts.length === 0 ? (
            <div className={kit.emptyBox}>{t('collaboration.mcpPromptsEmpty')}</div>
          ) : (
            <div className={kit.resList}>
              {prompts.map((p) => (
                <div key={`${p.server}:${p.name}`} className={kit.resItem}>
                  <span className={kit.iconTile}><Server strokeWidth={1.5} aria-hidden /></span>
                  <div className={kit.resMain}>
                    <div className={kit.resTitle}>{p.name}</div>
                    <div className={kit.resDesc}>{p.server}{p.description ? ` · ${p.description}` : ''}</div>
                  </div>
                  {p.arguments.length > 0 && (
                    <div className={kit.resSide}><span className={kit.badge}>{p.arguments.join(', ')}</span></div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showForm && (
        <div className={kit.resGroup} data-testid="mcp-add-form">
          <div className={kit.toolbar}>
            <input
              className={kit.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('collaboration.mcpNamePlaceholder')}
              aria-label={t('collaboration.mcpName')}
              data-testid="mcp-name-input"
              style={{ flex: 1, minWidth: 0 }}
            />
            <span className={kit.selectWrap}>
              <select
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
              </select>
            </span>
          </div>
          {transport === 'stdio' ? (
            <div className={kit.toolbar}>
              <input
                className={kit.input}
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder={t('collaboration.mcpCommandPlaceholder')}
                aria-label={t('collaboration.mcpCommand')}
                data-testid="mcp-command-input"
                style={{ flex: 1, minWidth: 0 }}
              />
              <input
                className={kit.input}
                value={argsText}
                onChange={(e) => { setArgsText(e.target.value); setArgsError(false); }}
                placeholder={t('collaboration.mcpArgsPlaceholder')}
                aria-label={t('collaboration.mcpArgs')}
                data-testid="mcp-args-input"
                style={{ flex: 1, minWidth: 0 }}
              />
            </div>
          ) : (
            <div className={kit.toolbar}>
              <input
                className={kit.input}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t('collaboration.mcpUrlPlaceholder')}
                aria-label={t('collaboration.mcpUrl')}
                data-testid="mcp-url-input"
                style={{ flex: 1, minWidth: 0 }}
              />
            </div>
          )}
          {transport === 'stdio' && <p className={kit.secDesc}>{t('collaboration.mcpArgsHint')}</p>}
          <button
            type="button"
            className={`${kit.btn} ${kit.primary}`}
            onClick={() => void submit()}
            disabled={busy || !name.trim()}
            data-testid="mcp-add-submit"
          >
            {t('collaboration.mcpAddSubmit')}
          </button>
          {argsError && <div className={kit.notice} role="alert"><span>{t('collaboration.mcpArgsUnclosedQuote')}</span></div>}
          {upsertMut.isError && (
            <div className={kit.notice} role="alert" data-testid="mcp-add-error">
              <span>{errorMessage(upsertMut.error)}</span>
            </div>
          )}
        </div>
      )}

      {showCatalog && (
        <div className={kit.resGroup} data-testid="mcp-catalog">
          {catalogQ.isLoading ? (
            <Spinner size={16} />
          ) : catalogQ.isError ? (
            <div className={kit.notice} role="alert"><span>{errorMessage(catalogQ.error)}</span></div>
          ) : catalog.length === 0 ? (
            <div className={kit.emptyBox}>{t('collaboration.mcpCatalogEmpty')}</div>
          ) : (
            <div className={kit.resList}>
              {catalog.map((c) => {
                const installed = servers.some((x) => x.name === c.id);
                return (
                  <div key={c.id} className={kit.resItem}>
                    <span className={kit.iconTile}><Library strokeWidth={1.5} aria-hidden /></span>
                    <div className={kit.resMain}>
                      <div className={kit.resTitle}>{c.name}</div>
                      <div className={kit.resDesc}>{c.description}</div>
                      <div className={kit.resDesc}><code className={kit.mono}>{c.installHint}</code></div>
                    </div>
                    <div className={kit.resSide}>
                      {installed ? (
                        <span className={kit.badge} data-fg>{t('collaboration.mcpInstalled')}</span>
                      ) : (
                        <button
                          type="button"
                          className={`${kit.btn} ${kit.outline}`}
                          onClick={() => void addFromCatalog(c.id)}
                          disabled={busy}
                          data-testid={`mcp-catalog-add-${c.id}`}
                        >
                          {t('collaboration.mcpAddSubmit')}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!showForm && upsertMut.isError && (
        <div className={kit.notice} role="alert"><span>{errorMessage(upsertMut.error)}</span></div>
      )}
      {deleteMut.isError && <div className={kit.notice} role="alert"><span>{errorMessage(deleteMut.error)}</span></div>}

      {serversQ.isLoading ? (
        <div className={kit.emptyBox}>
          <Spinner size={18} />
        </div>
      ) : serversQ.isError ? (
        <div className={kit.notice} role="alert"><span>{errorMessage(serversQ.error)}</span></div>
      ) : servers.length === 0 ? (
        <div className={kit.emptyBox}>
          {t('collaboration.mcpEmpty')} —— {t('collaboration.mcpEmptyHint')}
        </div>
      ) : (
        <div className={kit.resList} data-testid="mcp-server-list">
          {servers.map((m) => {
            const rt = runtime.find((r) => r.name === m.name);
            const failed = !m.running && rt?.status === 'failed';
            return (
              <div
                key={m.name}
                className={kit.resItem}
                data-status={failed ? 'failed' : m.running ? 'started' : 'stopped'}
              >
                <span
                  className={kit.dot}
                  data-ok={m.running && !failed ? true : undefined}
                  data-err={failed ? true : undefined}
                />
                <div className={kit.resMain}>
                  <div className={kit.resTitle}>{m.name}</div>
                  <div className={kit.resDesc}>
                    {m.transport}
                    {m.command ? ` · ${m.command} ${m.args.join(' ')}`.trimEnd() : ''}
                    {m.url ? ` · ${m.url}` : ''}
                  </div>
                  {failed && rt?.detail && <div className={kit.resDesc}>{rt.detail}</div>}
                </div>
                <div className={kit.resSide}>
                  <span className={kit.badge} data-fg={m.running && !failed ? true : undefined}>
                    {failed ? 'failed' : m.running ? 'started' : 'stopped'}
                  </span>
                  <button
                    type="button"
                    className={`${kit.btn} ${kit.destructive} ${kit.iconOnly}`}
                    disabled={busy}
                    onClick={() => deleteMut.mutate(m.name)}
                    title={t('collaboration.mcpRemove')}
                    aria-label={t('collaboration.mcpRemove')}
                    data-testid={`mcp-delete-${m.name}`}
                  >
                    <Trash2 strokeWidth={1.5} aria-hidden />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
