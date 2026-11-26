import { useRenderView } from '@/logic/renderer/useRenderView';
import { TitleBarBinding } from '@/logic/shell/TitleBarBinding';
import { TitleBar as DefaultView } from '@/render/harness/shell/TitleBar';

export function TitleBar(props: { sidebarOpen: boolean; onToggleSidebar: () => void; inspectorOpen: boolean; onToggleInspector: () => void }) {
  const View = useRenderView('TitleBar', DefaultView);
  // 右上角交互栈（任务 / 目标 / 子代理 / 建议）已并入会话区 chips 行
  // （composer 上方，见 features/shell/session/SessionDock.tsx）—— 不再是窗口级
  // fixed 浮层，避免在所有路由右上角飘浮。
  return <TitleBarBinding view={View} {...props} />;
}
