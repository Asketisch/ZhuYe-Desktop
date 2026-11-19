import { useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { useI18n } from '@/utils/i18n';
import { useRemoteController } from './useRemoteController';
import type { RemoteViewProps } from '@/contracts/remote';

export function RemoteBinding({ view: View }: { view: ComponentType<RemoteViewProps> }) {
  const { t } = useI18n();
  const ctrl = useRemoteController();
  const [copyOk, setCopyOk] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const copyPreview = async () => {
    if (!ctrl.previewCmd) return;
    try {
      await navigator.clipboard.writeText(ctrl.previewCmd);
      setCopyOk(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopyOk(false), 1500);
    } catch { /* 剪贴板不可用时保持原状态 */ }
  };
  return <View t={t} ctrl={ctrl} copyOk={copyOk} onCopyPreview={() => { void copyPreview(); }} />;
}
