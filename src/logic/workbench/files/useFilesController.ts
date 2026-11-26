import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { zhuye_agent_status, zhuye_list_dir, zhuye_read_file, zhuye_lsp_set_enabled, zhuye_lsp_status, zhuye_lsp_warmup, zhuye_lsp_diagnostics, type LspStatus } from '@/utils/commands';
import { useI18n } from '@/utils/i18n';
import { useEditorStore } from '@/stores/editorStore';
import { useAgentStore } from '@/stores/agentStore';
import { useFileDraftController } from '@/logic/workbench/files/useFileDraftController';

export function lspPrefKey(workspace: string | null): string { return `zhuye.lsp.enabled.${workspace ?? 'none'}`; }
export function readLspPref(workspace: string | null): boolean { try { return localStorage.getItem(lspPrefKey(workspace)) === 'on'; } catch { return false; } }
function writeLspPref(workspace: string | null, enabled: boolean): void { try { localStorage.setItem(lspPrefKey(workspace), enabled ? 'on' : 'off'); } catch { /* 隐私模式时仅本会话生效 */ } }
let lspQueue: Promise<void> = Promise.resolve();

export function useFilesController() {
  const { t } = useI18n();
  const statusQuery = useQuery({ queryKey: ['agent-status'], queryFn: zhuye_agent_status, staleTime: 30_000 });
  const workspace = statusQuery.data?.workspace ?? null;
  const treeQuery = useQuery({ queryKey: ['files-tree', workspace], queryFn: () => zhuye_list_dir(workspace, 4), enabled: !!workspace, staleTime: 10_000 });
  const [selected, setSelected] = useState<string | null>(null);
  const fileQuery = useQuery({ queryKey: ['files-read', selected], queryFn: () => zhuye_read_file(selected!), enabled: !!selected, staleTime: 60_000 });
  const [lsp, setLsp] = useState<LspStatus>({ enabled: false, servers: [], diagnostics: { documents: 0, count: 0, statusLine: '' } });
  const [lspBusy, setLspBusy] = useState(false);
  const [lspError, setLspError] = useState<string | null>(null);
  const translateRef = useRef(t); translateRef.current = t;
  const generationRef = useRef(0);
  useEffect(() => {
    const generation = ++generationRef.current;
    if (!workspace) { setLspBusy(true); return () => { generationRef.current += 1; }; }
    setLspBusy(true); setLspError(null);
    setLsp({ enabled: false, servers: [], diagnostics: { documents: 0, count: 0, statusLine: '' } });
    const pref = readLspPref(workspace);
    lspQueue = lspQueue.catch(() => {}).then(async () => {
      if (generation !== generationRef.current) return;
      try {
        let status = await zhuye_lsp_status();
        if (generation !== generationRef.current) return;
        if (status.enabled !== pref) status = await zhuye_lsp_set_enabled(pref);
        if (!status.enabled) useAgentStore.setState({ lspServers: [] });
        if (generation !== generationRef.current) return;
        setLsp(status);
        if (status.enabled !== pref) setLspError(translateRef.current('files.lspUnavailable'));
      } catch (error) { if (generation === generationRef.current) setLspError(error instanceof Error ? error.message : String(error)); }
      finally { if (generation === generationRef.current) setLspBusy(false); }
    });
    return () => { generationRef.current += 1; };
  }, [workspace]);
  const toggleLsp = () => {
    if (!workspace || lspBusy) return;
    const generation = generationRef.current; const next = !lsp.enabled;
    setLspBusy(true); setLspError(null);
    lspQueue = lspQueue.catch(() => {}).then(async () => {
      if (generation !== generationRef.current) return;
      try {
        const status = await zhuye_lsp_set_enabled(next);
        if (!status.enabled) useAgentStore.setState({ lspServers: [] });
        if (generation !== generationRef.current) return;
        setLsp(status);
        if (status.enabled === next) writeLspPref(workspace, next); else setLspError(t('files.lspUnavailable'));
      } catch (error) { if (generation === generationRef.current) setLspError(error instanceof Error ? error.message : String(error)); }
      finally { if (generation === generationRef.current) setLspBusy(false); }
    });
  };
  useEffect(() => { if (lspBusy || !lsp.enabled || !fileQuery.data || fileQuery.data.binary || !selected) return; void zhuye_lsp_warmup(fileQuery.data.path).catch(() => {}); }, [fileQuery.data, lsp.enabled, lspBusy, selected]);
  const diagnosticsQuery = useQuery({ queryKey: ['lsp-diagnostics', selected], queryFn: () => zhuye_lsp_diagnostics(selected as string), enabled: !!selected && lsp.enabled && !lspBusy, staleTime: 5_000, refetchInterval: lsp.enabled && !lspBusy ? 15_000 : false });
  const diagnostics = diagnosticsQuery.data ?? [];
  const pending = useEditorStore((state) => selected ? state.pending[selected] : undefined);
  const lastEditedPath = useEditorStore((state) => state.lastEditedPath);
  const acceptHunk = useEditorStore((state) => state.acceptHunk);
  const acceptAll = useEditorStore((state) => state.acceptAll);
  const rejectHunk = useEditorStore((state) => state.rejectHunk);
  const rejectAll = useEditorStore((state) => state.rejectAll);
  const draftController = useFileDraftController(selected, fileQuery.data);
  useEffect(() => { if (lastEditedPath) setSelected(lastEditedPath); }, [lastEditedPath]);
  const onAcceptHunk = (index: number) => { if (selected) acceptHunk(selected, index); };
  const onAcceptAll = () => { if (selected) acceptAll(selected); };
  const onRejectHunk = (index: number, content: string) => selected ? draftController.runReject(() => rejectHunk(selected, index, content)) : Promise.resolve(null);
  const onRejectAll = (content: string) => selected ? draftController.runReject(() => rejectAll(selected, content)) : Promise.resolve(null);
  const path = fileQuery.data?.path ?? selected ?? '';
  const hunks = pending?.hunks ?? [];
  const readOnly = !!fileQuery.data?.truncated || draftController.rejectingPath === selected;
  const contentVersion = useEditorStore((state) => selected ? state.contentVersion[selected] : undefined);
  const bufferRef = useRef<(() => string) | null>(null);
  return { t, workspace, treeQuery, selected, setSelected, fileQuery, lsp, lspBusy, lspError, toggleLsp, diagnostics, diagnosticsQuery, pending, draftController, path, hunks, readOnly, contentVersion, bufferRef, onAcceptHunk, onAcceptAll, onRejectHunk, onRejectAll };
}
export type FilesController = ReturnType<typeof useFilesController>;
