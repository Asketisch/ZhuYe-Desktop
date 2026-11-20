import { useRenderView } from '@/logic/renderer/useRenderView';
import { TitleBarBinding } from '@/logic/shell/TitleBarBinding';
import { TitleBar as DefaultView } from '@/render/shell/TitleBar';
import { CornerStack } from './corner/CornerStack';

export function TitleBar(props: { sidebarOpen: boolean; onToggleSidebar: () => void; inspectorOpen: boolean; onToggleInspector: () => void }) {
  const View = useRenderView('TitleBar', DefaultView);
  return (
    <>
      <TitleBarBinding view={View} {...props} />
      {/* 右上角交互栈：任务清单 / 目标 / 子代理 / 建议（fixed 定位，与标题条同层挂载） */}
      <CornerStack />
    </>
  );
}
