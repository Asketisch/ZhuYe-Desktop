import type { ComponentProps, ComponentType, ReactNode } from 'react';
import type { TitleBar } from '@/features/shell/TitleBar';
import type { Sidebar } from '@/features/sessions/components/Sidebar';
import type { CommandPalette } from '@/features/command-palette/CommandPalette';
import type { ModalStack } from '@/features/modals';
import type { Toast as ToastView } from '@/features/design-system';
import type { Toast } from '@/stores/agent/types';

export interface ShellSlots {
  TitleBar: ComponentType<ComponentProps<typeof TitleBar>>;
  Sidebar: ComponentType<ComponentProps<typeof Sidebar>>;
  CommandPalette: ComponentType<ComponentProps<typeof CommandPalette>>;
  ModalStack: ComponentType<ComponentProps<typeof ModalStack>>;
  Toast: ComponentType<ComponentProps<typeof ToastView>>;
  ZRail: ComponentType<{ onOpenUpdates: () => void }>;
  Inspector: ComponentType;
  StatusBar: ComponentType;
  ConfirmDialogHost: ComponentType;
  ViewErrorBoundary: ComponentType<{ children: ReactNode }>;
}

export interface ShellViewProps {
  titleBar: ComponentProps<typeof TitleBar>;
  sidebar: ComponentProps<typeof Sidebar>;
  palette: ComponentProps<typeof CommandPalette>;
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  sidebarLabel: string;
  inspectorLabel: string;
  suppressInteraction: boolean;
  toasts: Toast[];
  onDismissToast: (id: string) => void;
  onOpenUpdates: () => void;
  content: ReactNode;
  slots: ShellSlots;
}
