import { Outlet } from '@tanstack/react-router';
import { useRenderer } from '@/logic/renderer/RendererProvider';
import { ShellBinding } from '@/logic/shell/ShellBinding';
import { AppShell as DefaultView } from '@/render/shell/AppShell';
import { ZRail } from './zcode/ZRail';
import { TitleBar } from './TitleBar';
import { StatusBar } from './StatusBar';
import { Inspector } from './Inspector';
import { Sidebar } from '@/features/sessions/components/Sidebar';
import { ModalStack } from '@/features/modals';
import { ConfirmDialogHost } from '@/features/modals/ConfirmDialog';
import { CommandPalette } from '@/features/command-palette/CommandPalette';
import { Toast } from '@/features/design-system';
import { ViewErrorBoundary } from './ErrorBoundary';

const slots = { ZRail, TitleBar, StatusBar, Inspector, Sidebar, ModalStack,
  ConfirmDialogHost, CommandPalette, Toast, ViewErrorBoundary };

export function AppShell() {
  const renderer = useRenderer();
  return <ShellBinding view={renderer?.AppShell ?? DefaultView} slots={slots} content={<Outlet />} />;
}
