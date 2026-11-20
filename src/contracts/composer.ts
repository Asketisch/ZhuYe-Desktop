import type { ComponentProps, ComponentType, Ref, ChangeEventHandler, ClipboardEventHandler, DragEventHandler, KeyboardEventHandler } from 'react';
import type { I18nContextValue } from '@/utils/i18n/context';
import type { StagedAttachment } from '@/logic/composer/useAttachments';
import type { BangRun } from '@/logic/composer/useBangShell';
import type { SlashPopup } from '@/features/composer/SlashPopup';
import type { MentionPicker } from '@/features/composer/MentionPicker';
import type { ComposerPlusMenu } from '@/features/composer/ComposerPlusMenu';
import type { ModelPicker } from '@/features/composer/ModelPicker';

export interface ComposerSlots {
  SlashPopup: ComponentType<ComponentProps<typeof SlashPopup>>;
  MentionPicker: ComponentType<ComponentProps<typeof MentionPicker>>;
  AttachmentBar: ComponentType<{ attachments: StagedAttachment[]; onRemove: (index: number) => void; onRetry: (id: string) => void }>;
  BangRunsPanel: ComponentType<{ runs: BangRun[]; onDismiss: (id: string) => void; onKill: (id: string) => void }>;
  ContextUsage: ComponentType;
  ComposerControls: ComponentType;
  ComposerContextBar: ComponentType;
  /** 卡片底栏左侧的「+」入口菜单（zcode 式）。 */
  ComposerPlusMenu: ComponentType<ComponentProps<typeof ComposerPlusMenu>>;
  /** 卡片底栏右侧的模型选择器。 */
  ModelPicker: ComponentType<ComponentProps<typeof ModelPicker>>;
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
  attachments: StagedAttachment[];
  /** 视觉降级警示：当前模型**明确**不支持视觉且附件含图片（未知不警示）。 */
  visionBlocked: boolean;
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
  onOpenSlash: () => void;
  onAttachFile: () => void;
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
  /** 「+」菜单：立即执行的会话命令（如压缩）。 */
  onRunSlash: (command: string) => void;
  /** 「+」菜单：需要补参数的命令 —— 把 `/cmd ` 填进输入框。 */
  onFillSlash: (command: string) => void;
  /** 「+」菜单：把文本追加到输入框（如技能名）。 */
  onInsertText: (text: string) => void;
  /** 语音输入：是否正在识别。 */
  dictationSupported: boolean;
  dictationListening: boolean;
  onToggleDictation: () => void;
  slots: ComposerSlots;
}
