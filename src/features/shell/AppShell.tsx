import { Outlet } from '@tanstack/react-router';
import { useRenderer } from '@/logic/renderer/RendererProvider';
import { ShellBinding } from '@/logic/shell/ShellBinding';
import { AppShell as DefaultView } from '@/render/shell/AppShell';
import { TitleBar } from './TitleBar';
import { StatusBar } from './StatusBar';
import { Inspector } from './Inspector';
import { DockPanel } from './DockPanel';
import { TerminalDock } from './TerminalDock';
import { InboxPanel } from './InboxPanel';
import { SettingsHost } from './SettingsHost';
import { Sidebar } from '@/features/sessions/components/Sidebar';
import { ModalStack } from '@/features/modals';
import { ConfirmDialogHost } from '@/features/modals/ConfirmDialog';
import { CommandPalette } from '@/features/command-palette/CommandPalette';
import { Toast } from '@/features/design-system';
import { ViewErrorBoundary } from './ErrorBoundary';

/** harness 壳层槽位：dock / 终端面板 / 任务中心 / 设置弹窗随壳层一并换新。 */
const slots = { TitleBar, StatusBar, Inspector, DockPanel, TerminalDock, InboxPanel,
  SettingsHost, Sidebar, ModalStack, ConfirmDialogHost, CommandPalette, Toast, ViewErrorBoundary };

export function AppShell() {
  const renderer = useRenderer();
  return <ShellBinding view={renderer?.AppShell ?? DefaultView} slots={slots} content={<Outlet />} />;
}
