import type { ComponentType } from 'react';
import type { TerminalViewProps } from '@/contracts/workbench/terminal';
import { useI18n } from '@/utils/i18n';
import { useTerminalScroll } from '@/logic/webview/useTerminalScroll';
import { useTerminalController } from './useTerminalController';

/** 将终端状态和动作交给调用方提供的展示组件。 */
export function TerminalBinding({ view: View }: { view: ComponentType<TerminalViewProps> }) {
  const { t, tp } = useI18n();
  const controller = useTerminalController();
  const bottomRef = useTerminalScroll(controller.activeLines, controller.state.activeId);

  return (
    <View
      state={controller.state}
      activeLines={controller.activeLines}
      activeSession={controller.activeSession}
      bottomRef={bottomRef}
      t={t}
      tp={tp}
      onSelectSession={controller.selectSession}
      onInputChange={controller.setInput}
      onSubmit={() => { if (!controller.state.busy) void controller.run(controller.state.input); }}
      onKill={() => { void controller.killActive(); }}
      onClear={controller.clearActive}
    />
  );
}
