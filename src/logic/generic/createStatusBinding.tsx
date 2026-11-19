import type { ComponentType } from 'react';
import type { StatusViewProps } from '@/contracts/generic';

/** 将静态文案与状态投影给展示组件。 */
export function createStatusBinding(text: string, testId?: string) {
  return function StatusBinding({ view: View, kind }: { view: ComponentType<StatusViewProps>; kind?: string }) {
    return <View text={text} kind={kind} testId={testId} t={(key) => key} />;
  };
}
