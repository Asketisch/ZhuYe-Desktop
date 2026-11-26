import { MessageSquare, Search, X } from 'lucide-react';
import type { SearchViewProps } from '@/contracts/workbench/search';
import { PageShell } from '@/render/harness/shell/PageShell';
import { Card } from '@/render/harness/design-system/Card';
import { Badge } from '@/render/harness/design-system/Badge';
import { Icon } from '@/render/harness/design-system/Icon';
import { Spinner } from '@/render/harness/design-system/Spinner';
import { EmptyState } from '@/render/harness/design-system/EmptyState';
import s from './SearchView.module.css';

export function SearchView({ t, tp, tab, query, rank, sessionHits, fileHits, truncated, loading, error,
  onTabChange, onQueryChange, onToggleRank, onOpenSession, onOpenFile }: SearchViewProps) {
  return (
    <PageShell
      icon={Search}
      title={t('files.findInFiles')}
      subtitle={t('files.findInFilesSubtitle')}
      width="lg"
    >
      <Card level="flat" padding="lg">
        <div className={s.tabs} role="tablist" aria-label={t('files.findInFiles')} data-testid="search-tabs">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'sessions'}
            className={s.tab}
            data-active={tab === 'sessions' || undefined}
            onClick={() => onTabChange('sessions')}
            data-testid="search-tab-sessions"
          >
            <Icon icon={MessageSquare} size={13} /> {t('search.tab.sessions')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'files'}
            className={s.tab}
            data-active={tab === 'files' || undefined}
            onClick={() => onTabChange('files')}
            data-testid="search-tab-files"
          >
            <Icon icon={Search} size={13} /> {t('search.tab.files')}
          </button>
        </div>

        <div className={s.searchBox}>
          <Icon icon={Search} size={14} />
          <input
            className={s.input}
            placeholder={t('files.findPlaceholder')}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            autoFocus
            aria-label="Find in files query"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              aria-label="Clear search"
              className={s.clear}
            >
              <Icon icon={X} size={14} />
            </button>
          )}
          {/* 文件 tab 的排序方式:子串 vs BM25 相关性(与 agent 的 grep 同款)。 */}
          {tab === 'files' && (
            <button
              type="button"
              className={s.rankToggle}
              data-active={rank === 'bm25' || undefined}
              onClick={onToggleRank}
              title={
                rank === 'bm25'
                  ? t('search.rank.bm25Hint')
                  : t('search.rank.substringHint')
              }
              data-testid="search-rank-toggle"
            >
              {rank === 'bm25' ? 'BM25' : t('search.rank.substring')}
            </button>
          )}
        </div>

        {loading && (
          <div className={s.status}>
            <Spinner size={14} /> {t('files.findSearching')}
          </div>
        )}

        {!loading && error && (
          <EmptyState
            size="sm"
            icon={<Icon icon={Search} size={20} />}
            title={t('files.findFailed')}
            description={error}
          />
        )}

        {!loading && !error && query && (tab === 'sessions' ? sessionHits : fileHits).length === 0 && (
          <EmptyState
            size="sm"
            icon={<Icon icon={Search} size={20} />}
            title={t('files.findNoMatches')}
            description={t('files.findNoMatchesDesc', { query })}
          />
        )}

        {!loading && tab === 'sessions' && sessionHits.length > 0 && (
          <>
            <div className={s.summary}>
              <Badge variant="info">{tp('search.sessionHits', sessionHits.length, { count: sessionHits.length })}</Badge>
            </div>
            <ul className={s.list}>
              {sessionHits.map((h) => (
                <li key={h.session_id}>
                  <button
                    type="button"
                    className={s.hitButton}
                    data-testid={`session-hit-${h.session_id}`}
                    onClick={() => onOpenSession(h.session_id)}
                  >
                    <div className={s.hitPath}>
                      <code className={s.path}>{h.title ?? h.session_id}</code>
                      <Badge variant="neutral">×{h.match_count}</Badge>
                    </div>
                    <pre className={s.context}>{h.snippet}</pre>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {!loading && tab === 'files' && fileHits.length > 0 && (
          <>
            <div className={s.summary}>
              <Badge variant="info">
                {tp('files.findHits', fileHits.length)}
              </Badge>
              {truncated && <Badge variant="warning">{t('files.findTruncated')}</Badge>}
            </div>
            <ul className={s.list}>
              {fileHits.map((h, idx) => (
                <li key={`${h.path}-${h.line}-${idx}`}>
                  <button
                    type="button"
                    className={s.hitButton}
                    onClick={() =>
                      onOpenFile(h.path, h.line)
                    }
                  >
                    <div className={s.hitPath}>
                      <code className={s.path}>{h.path}</code>
                      <Badge variant="neutral">L{h.line}</Badge>
                    </div>
                    <pre className={s.context}>{h.context}</pre>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </PageShell>
  );
}
