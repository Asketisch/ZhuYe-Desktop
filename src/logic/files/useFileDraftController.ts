import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useEditorStore } from '@/stores/editorStore';
import { useAgentStore } from '@/stores/agentStore';
import { reflect_read_file, reflect_write_file, type ReflectFileReadResult } from '@/utils/commands';
import { useI18n } from '@/utils/i18n';

export function useFileDraftController(selected: string | null, file: ReflectFileReadResult | undefined) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [rejectingPath, setRejectingPath] = useState<string | null>(null);
  const [resetVersion, setResetVersion] = useState(0);
  const rejectingRef = useRef(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => { setActionError(null); }, [selected]);
  const draft = useEditorStore((st) => selected ? st.drafts[selected] : undefined);
  const saving = useEditorStore((st) => selected ? !!st.saving[selected] : false);
  const setDraft = useEditorStore((st) => st.setDraft);
  const markSaved = useEditorStore((st) => st.markSaved);
  const clearDraft = useEditorStore((st) => st.clearDraft);
  const beginSave = useEditorStore((st) => st.beginSave);
  const endSave = useEditorStore((st) => st.endSave);

  const reportError = (target: string, message: string) => {
    if (mountedRef.current && selectedRef.current === target) setActionError(message);
    else useAgentStore.getState().pushToast({ kind: 'error', message });
  };

  const onSave = async () => {
    if (!selected || !draft || draft.text === draft.base || rejectingRef.current ||
        !file || file.binary || file.truncated) return;
    const target = selected;
    const snapshot = draft;
    if (!beginSave(target)) return;
    try {
      const size = new TextEncoder().encode(snapshot.text).length;
      if (size > 1_048_576) throw new Error(t('files.editor.exceedsLimit', { kb: '1024' }));
      const disk = await reflect_read_file(target);
      if (disk.binary || disk.truncated || disk.content !== snapshot.base) {
        throw new Error(t('files.editor.conflict'));
      }
      await reflect_write_file(target, snapshot.text);
      markSaved(target, snapshot.text);
      qc.setQueryData<ReflectFileReadResult>(['files-read', target], (old) => old
        ? { ...old, content: snapshot.text, size }
        : old);
      if (mountedRef.current && selectedRef.current === target) setActionError(null);
    } catch (error) {
      reportError(target, t('files.editor.saveFailed', { msg: error instanceof Error ? error.message : String(error) }));
    } finally {
      endSave(target);
    }
  };

  const onReload = async () => {
    if (!selected || rejectingRef.current) return;
    const target = selected;
    const snapshot = draft;
    if (!beginSave(target)) return;
    rejectingRef.current = true;
    setRejectingPath(target);
    try {
      const disk = await reflect_read_file(target);
      if (useEditorStore.getState().drafts[target] !== snapshot) return;
      qc.setQueryData(['files-read', target], disk);
      clearDraft(target);
      if (mountedRef.current) setResetVersion((version) => version + 1);
      if (mountedRef.current && selectedRef.current === target) setActionError(null);
    } catch (error) {
      reportError(target, t('files.editor.reloadFailed', { msg: error instanceof Error ? error.message : String(error) }));
    } finally {
      endSave(target);
      rejectingRef.current = false;
      if (mountedRef.current) setRejectingPath(null);
    }
  };

  const runReject = async (operation: () => Promise<string | null>): Promise<string | null> => {
    if (!selected || rejectingRef.current) return null;
    const target = selected;
    const originalDraft = useEditorStore.getState().drafts[target];
    const expected = originalDraft?.base ?? file?.content;
    if (expected === undefined || !beginSave(target)) return null;
    rejectingRef.current = true;
    setRejectingPath(target);
    try {
      const disk = await reflect_read_file(target);
      if (disk.binary || disk.truncated || disk.content !== expected) {
        reportError(target, t('files.editor.diskChanged'));
        return null;
      }
      const next = await operation();
      if (next === null) {
        reportError(target, t('files.rejectFailed'));
        return null;
      }
      if (mountedRef.current && selectedRef.current === target) setActionError(null);
      if (useEditorStore.getState().drafts[target] === originalDraft) clearDraft(target);
      else markSaved(target, next);
      qc.setQueryData<ReflectFileReadResult>(['files-read', target], (old) =>
        old ? { ...old, content: next } : old,
      );
      if (mountedRef.current) setResetVersion((version) => version + 1);
      return next;
    } catch (error) {
      reportError(target, t('files.editor.reloadFailed', { msg: error instanceof Error ? error.message : String(error) }));
      return null;
    } finally {
      endSave(target);
      rejectingRef.current = false;
      if (mountedRef.current) setRejectingPath(null);
    }
  };

  const onChange = (text: string) => {
    if (selected && file) setDraft(selected, text, file.content, !!useEditorStore.getState().saving[selected]);
  };

  return { actionError, rejectingPath, resetVersion, draft, saving, onSave, onReload, runReject, onChange };
}
