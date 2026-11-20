import { useEffect, useRef, useState } from 'react';
import { zhuye_git_status, zhuye_git_diff, zhuye_git_log, zhuye_git_stage, zhuye_git_unstage, zhuye_git_commit, type ZhuyeGitStatus, type ZhuyeGitLogEntry } from '@/utils/commands';
import { useAgentStore } from '@/stores/agentStore';
import type { I18nContextValue } from '@/utils/i18n/context';
export type GitTab = 'working' | 'staged';
export function useGitController(t: I18nContextValue['t']) {
  const pushToast = useAgentStore((state) => state.pushToast);
  const [status, setStatus] = useState<ZhuyeGitStatus | null>(null);
  const [diff, setDiff] = useState('');
  const [tab, setTab] = useState<GitTab>('working');
  const [log, setLog] = useState<ZhuyeGitLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [commitMessage, setCommitMessage] = useState('');
  const [mutating, setMutating] = useState(false);
  const seqRef = useRef(0);
  const refresh = async () => {
    const seq = ++seqRef.current; setLoading(true); setError(null);
    try {
      const [nextStatus, nextDiff, nextLog] = await Promise.all([zhuye_git_status(), zhuye_git_diff(tab === 'staged'), zhuye_git_log(20)]);
      if (seq !== seqRef.current) return;
      setStatus(nextStatus); setDiff(nextDiff); setLog(nextLog); setSelected(new Set());
    } catch (cause) { if (seq === seqRef.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (seq === seqRef.current) setLoading(false); }
  };
  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab]);
  const entries = status?.entries ?? [];
  const stagedEntries = entries.filter((entry) => entry.staged);
  const workingEntries = entries.filter((entry) => !entry.staged || (entry.status.length > 1 && entry.status[1] !== ' '));
  const listEntries = tab === 'working' ? workingEntries : stagedEntries;
  const allChecked = listEntries.length > 0 && listEntries.every((entry) => selected.has(entry.path));
  const toggleEntry = (path: string) => setSelected((previous) => { const next = new Set(previous); if (next.has(path)) next.delete(path); else next.add(path); return next; });
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(listEntries.map((entry) => entry.path)));
  const stageOrUnstage = async () => { const paths = [...selected]; if (!paths.length || mutating) return; setMutating(true); try { if (tab === 'working') await zhuye_git_stage(paths); else await zhuye_git_unstage(paths); await refresh(); } catch (cause) { pushToast({ kind: 'error', message: cause instanceof Error ? cause.message : String(cause) }); } finally { setMutating(false); } };
  const commit = async () => { const message = commitMessage.trim(); if (!message || mutating) return; setMutating(true); try { const short = await zhuye_git_commit(message); pushToast({ kind: 'success', message: t('git.commitDone', { short }) }); setCommitMessage(''); await refresh(); } catch (cause) { pushToast({ kind: 'error', message: cause instanceof Error ? cause.message : String(cause) }); } finally { setMutating(false); } };
  return { status, diff, tab, setTab, log, error, loading, selected, commitMessage, setCommitMessage, mutating, refresh, entries, stagedEntries, workingEntries, listEntries, allChecked, toggleEntry, toggleAll, stageOrUnstage, commit };
}
export type GitController = ReturnType<typeof useGitController>;
