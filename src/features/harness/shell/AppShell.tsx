import { Outlet } from '@tanstack/react-router';
import { useRenderer } from '@/logic/harness/renderer/RendererProvider';
import { ShellBinding } from '@/logic/harness/shell/ShellBinding';
import { AppShell as DefaultView } from '@/render/harness/shell/AppShell';
import { TitleBar } from './TitleBar';
import { StatusBar } from './StatusBar';
import { Inspector } from './Inspector';
import { DockPanel } from './DockPanel';
import { DockResizer } from './DockResizer';
import { TerminalDock } from './TerminalDock';
import { InboxPanel } from './InboxPanel';
import { SettingsHost } from './SettingsHost';
import { DockOverlays } from './DockOverlays';
import { Sidebar } from '@/features/conversation/sessions/components/Sidebar';
import { ModalStack } from '@/features/harness/modals';
import { ConfirmDialogHost } from '@/features/harness/modals/ConfirmDialog';
import { CommandPalette } from '@/features/input/command-palette/CommandPalette';
import { Toast } from '@/features/harness/design-system';
import { ViewErrorBoundary } from './ErrorBoundary';

/** harness 壳层槽位：dock / 终端面板 / 任务中心 / 设置弹窗随壳层一并换新。 */
const slots = { TitleBar, StatusBar, Inspector, DockPanel, DockResizer, TerminalDock, InboxPanel,
  SettingsHost, DockOverlays, Sidebar, ModalStack, ConfirmDialogHost, CommandPalette, Toast, ViewErrorBoundary };

export function AppShell() {
  const renderer = useRenderer();
  return <ShellBinding view={renderer?.AppShell ?? DefaultView} slots={slots} content={<Outlet />} />;
}
