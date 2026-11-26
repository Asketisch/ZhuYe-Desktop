import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useI18n } from '@/utils/i18n';
import { zhuye_search_files, zhuye_search_sessions, type ZhuyeFileSearchHit, type ZhuyeSessionSearchHit, type SearchRank } from '@/utils/commands';
import type { SearchTab, SearchViewProps } from '@/contracts/workbench/search';

export function SearchBinding({ view: View }: { view: ComponentType<SearchViewProps> }) {
  const navigate = useNavigate();
  const { t, tp } = useI18n();
  const [tab, setTab] = useState<SearchTab>('sessions');
  const [query, setQuery] = useState('');
  const [rank, setRank] = useState<SearchRank>('substring');
  const [sessionHits, setSessionHits] = useState<ZhuyeSessionSearchHit[]>([]);
  const [fileHits, setFileHits] = useState<ZhuyeFileSearchHit[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const sequence = useRef(0);
  const runSearch = useCallback(async (text: string, which: SearchTab, currentRank: SearchRank) => {
    const trimmed = text.trim();
    if (!trimmed) { setSessionHits([]); setFileHits([]); setTruncated(false); setError(null); return; }
    const seq = ++sequence.current;
    setLoading(true);
    try {
      if (which === 'sessions') { const response = await zhuye_search_sessions(trimmed, 30); if (seq !== sequence.current) return; setSessionHits(response); setTruncated(false); }
      else { const response = await zhuye_search_files(trimmed, null, 200, currentRank); if (seq !== sequence.current) return; setFileHits(response?.hits ?? []); setTruncated(response?.truncated ?? false); }
      setError(null);
    } catch (cause) {
      if (seq !== sequence.current) return;
      if (which === 'sessions') setSessionHits([]); else setFileHits([]);
      setTruncated(false); setError((cause as Error).message);
    } finally { if (seq === sequence.current) setLoading(false); }
  }, []);
  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void runSearch(query, tab, rank); }, 200);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [query, rank, tab, runSearch]);
  return <View t={t} tp={tp} tab={tab} query={query} rank={rank} sessionHits={sessionHits} fileHits={fileHits}
    truncated={truncated} loading={loading} error={error}
    onTabChange={setTab} onQueryChange={setQuery}
    onToggleRank={() => setRank((current) => current === 'bm25' ? 'substring' : 'bm25')}
    onOpenSession={(id) => { void navigate({ to: '/chat/$sessionId', params: { sessionId: id } } as never); }}
    onOpenFile={(path, line) => { void navigate({ to: '/files', search: { path, line } } as never); }} />;
}
