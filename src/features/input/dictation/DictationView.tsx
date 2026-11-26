import { useRenderView } from '@/logic/renderer/useRenderView';
import { DictationBinding } from '@/logic/dictation/DictationBinding';
import { DictationView as DefaultView } from '@/render/input/dictation/DictationView';

export interface DictationViewProps { onInsertIntoComposer?: (text: string) => void }

export function DictationView({ onInsertIntoComposer }: DictationViewProps) {
  const View = useRenderView('DictationView', DefaultView);
  return <DictationBinding view={View} onInsert={onInsertIntoComposer} />;
}
