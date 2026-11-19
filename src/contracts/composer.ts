import type { ComponentProps, ComponentType, Ref, ChangeEventHandler, ClipboardEventHandler, DragEventHandler, KeyboardEventHandler } from 'react';
import type { I18nContextValue } from '@/utils/i18n/context';
import type { StagedAttachment } from '@/logic/composer/useAttachments';
import type { BangRun } from '@/logic/composer/useBangShell';
import type { SlashPopup } from '@/features/composer/SlashPopup';
import type { MentionPicker } from '@/features/composer/MentionPicker';

export interface ComposerSlots {
  SlashPopup: ComponentType<ComponentProps<typeof SlashPopup>>;
  MentionPicker: ComponentType<ComponentProps<typeof MentionPicker>>;
  AttachmentBar: ComponentType<{ attachments: StagedAttachment[]; onRemove: (index: number) => void; onRetry: (id: string) => void }>;
  BangRunsPanel: ComponentType<{ runs: BangRun[]; onDismiss: (id: string) => void; onKill: (id: string) => void }>;
  ContextUsage: ComponentType;
  ComposerControls: ComponentType;
  ComposerContextBar: ComponentType;
}

export interface ComposerViewProps {
  t: I18nContextValue['t'];
  text: string;
  busy: boolean;
  canSend: boolean;
  sendLabel: string;
  sendMode: 'queue' | 'steer';
  isTurnRunning: boolean;
  slashVisible: boolean;
  slashQuery: string;
  slashActiveIdx: number;
  mentionVisible: boolean;
  mentionQuery: string;
  workspaceLabel?: string;
  toolbar: Array<{ name: string; summary: string }>;
  attachments: StagedAttachment[];
  dragActive: boolean;
  bangRuns: BangRun[];
  textareaRef: Ref<HTMLTextAreaElement>;
  fileInputRef: Ref<HTMLInputElement>;
  imageInputRef: Ref<HTMLInputElement>;
  onChange: ChangeEventHandler<HTMLTextAreaElement>;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  onPaste: ClipboardEventHandler<HTMLTextAreaElement>;
  onDrop: DragEventHandler<HTMLDivElement>;
  onDragOver: DragEventHandler<HTMLDivElement>;
  onPickFile: (files: FileList | null) => void;
  onPickImage: (files: FileList | null) => void;
  onSlashActiveChange: (index: number) => void;
  onSlashSelect: (command: string) => void;
  onToolbarCommand: (command: string) => void;
  onOpenSlash: () => void;
  onAttachFile: () => void;
  onAttachImage: () => void;
  onMention: () => void;
  onPickMention: (path: string) => void;
  onCloseMention: () => void;
  onRemoveAttachment: (index: number) => void;
  onRetryAttachment: (id: string) => void;
  onDismissBang: (id: string) => void;
  onKillBang: (id: string) => void;
  onSendModeChange: (mode: 'queue' | 'steer') => void;
  onInterrupt: () => void;
  onSend: () => void;
  slots: ComposerSlots;
}
