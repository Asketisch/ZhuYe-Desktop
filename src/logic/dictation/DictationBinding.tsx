import { useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { useI18n } from '@/utils/i18n';
import { useDictation } from '@/logic/dictation/useDictation';
import type { DictationViewProps } from '@/contracts/conversation/dictation';

export function DictationBinding({ view: View, onInsert }: { view: ComponentType<DictationViewProps>; onInsert?: (text: string) => void }) {
  const { t, dictationLang } = useI18n();
  const dictation = useDictation({ lang: dictationLang, continuous: true });
  const [holdMode, setHoldMode] = useState(false);
  const [copyOk, setCopyOk] = useState(false);
  const copyTimer = useRef<number | null>(null);
  const copy = async () => {
    if (!dictation.transcript) return;
    try {
      await navigator.clipboard.writeText(dictation.transcript);
      setCopyOk(true);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopyOk(false), 1500);
    } catch { /* 剪贴板不可用时保留原状态 */ }
  };
  useEffect(() => () => { if (copyTimer.current) window.clearTimeout(copyTimer.current); }, []);
  return <View t={t} isSupported={dictation.isSupported} isListening={dictation.isListening}
    transcript={dictation.transcript} error={dictation.error} holdMode={holdMode} copyOk={copyOk}
    onToggleListen={() => dictation.isListening ? dictation.stop() : dictation.start()}
    onHoldModeChange={setHoldMode} onHoldStart={dictation.start} onHoldEnd={dictation.stop}
    onReset={dictation.reset} onCopy={() => { void copy(); }} onInsert={onInsert} />;
}
