/**
 * DockPanel —— 右 dock 的五档内容调度器。
 *
 * dock-modes 头部按钮在 AppShell 渲染；本组件只渲染当前档位的面板体：
 * - inspector：既有检查器（运行状态 / 上下文 / 变更 / 事件）
 * - browser：受控浏览器（CDP screencast + 导航栏）
 * - files：文件树 + 代码预览
 * - agents：子代理记录
 * - usage：用量面板
 */
import { Inspector } from '@/features/shell/Inspector';
import { BrowserDock } from '@/features/browser/BrowserDock';
import { FilesDock } from '@/features/files/FilesDock';
import { AgentsDock } from '@/features/agents/AgentsDock';
import { UsageDock } from '@/features/usage/UsageDock';
import { useShellUi } from '@/stores/shellUi';

export function DockPanel() {
  const dockMode = useShellUi((s) => s.dockMode);
  switch (dockMode) {
    case 'browser':
      return <BrowserDock />;
    case 'files':
      return <FilesDock />;
    case 'agents':
      return <AgentsDock />;
    case 'usage':
      return <UsageDock />;
    case 'inspector':
    default:
      return <Inspector />;
  }
}
