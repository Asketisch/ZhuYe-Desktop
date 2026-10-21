/**
 * SearchView —— 全局搜索页：会话内容 / 工作区文件 双 tab。
 *
 * v1.x P1：补上跨会话内容搜索（此前该页是孤儿路由且只能搜文件）。
 * - 会话 tab：`reflect_search_sessions` 后端 grep 会话 JSONL 的
 *   user/assistant 文本（覆盖活跃树 + 归档树，最近 120 个会话），
 *   点击命中跳转 `/chat/$id` 回看。
 * - 文件 tab：`reflect_search_files` 工作区文本搜索（原行为），
 *   点击命中在 Files 视图打开对应行。
 * 输入即查（200ms 防抖）+ 请求令牌防乱序。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { MessageSquare, Search, X } from 'lucide-react';
import { PageShell } from '@/features/shell/PageShell';
import { Card, Badge, Icon, Spinner, EmptyState } from '@/features/design-system';
import { useI18n } from '@/utils/i18n';
import {
  reflect_search_files,
  reflect_search_sessions,
  type ReflectFileSearchHit,
  type ReflectSessionSearchHit,
  type SearchRank,
} from '@/utils/commands';
import s from './SearchView.module.css';

type SearchTab = 'sessions' | 'files';

export function SearchView() {
  const navigate = useNavigate();
  const { t, tp } = useI18n();
  const [tab, setTab] = useState<SearchTab>('sessions');
  const [query, setQuery] = useState('');
  // 文件 tab 的排序方式:默认子串匹配;BM25 与 agent 自己的 grep 同款。
  const [rank, setRank] = useState<SearchRank>('substring');
  const [sessionHits, setSessionHits] = useState<ReflectSessionSearchHit[]>([]);
  const [fileHits, setFileHits] = useState<ReflectFileSearchHit[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  // 单调递增的请求令牌：乱序响应会被丢弃，这样较慢的旧查询永远不会覆盖较新的查询结果。
  const seqRef = useRef(0);

  const runSearch = useCallback(async (q: string, which: SearchTab) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setSessionHits([]);
      setFileHits([]);
      setTruncated(false);
      setError(null);
      return;
    }
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      if (which === 'sessions') {
        const res = await reflect_search_sessions(trimmed, 30);
        if (seq !== seqRef.current) return; // 已过时
        setSessionHits(res);
        setTruncated(false);
      } else {
        const res = await reflect_search_files(trimmed, null, 200, rank);
        if (seq !== seqRef.current) return; // 已过时
        setFileHits(res?.hits ?? []);
        setTruncated(res?.truncated ?? false);
      }
      setError(null);
    } catch (e) {
      if (seq !== seqRef.current) return; // 已过时
      if (which === 'sessions') setSessionHits([]);
      else setFileHits([]);
      setTruncated(false);
      setError((e as Error).message);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void runSearch(query, tab);
    }, 200);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, tab, runSearch]);

  const hits = tab === 'sessions' ? sessionHits : fileHits;

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
            onClick={() => setTab('sessions')}
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
            onClick={() => setTab('files')}
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
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            aria-label="Find in files query"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
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
              onClick={() => setRank((r) => (r === 'bm25' ? 'substring' : 'bm25'))}
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

        {!loading && !error && query && hits.length === 0 && (
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
                    onClick={() => navigate({ to: '/chat/$sessionId', params: { sessionId: h.session_id } } as never)}
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
                      navigate({
                        to: '/files',
                        search: { path: h.path, line: h.line } as never,
                      } as never)
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
