import { useRenderer } from '@/logic/harness/renderer/RendererProvider';
import { ComposerBinding } from '@/logic/input/composer/ComposerBinding';
import { Composer as DefaultView } from '@/render/input/composer/Composer';
import { SlashPopup } from '@/features/input/composer/menus/SlashPopup';
import { AttachmentBar } from '@/features/input/composer/attachments/AttachmentBar';
import { MentionPicker } from '@/features/input/composer/pickers/MentionPicker';
import { ContextUsage } from './ContextUsage';
import { ComposerTopBar } from '@/features/input/composer/topbar/ComposerTopBar';
import { PermissionPicker } from '@/features/input/composer/pickers/PermissionPicker';
import { PromptPicker } from '@/features/input/composer/pickers/PromptPicker';
import { EffortPicker } from '@/features/input/composer/pickers/EffortPicker';
import { BangRunsPanel } from '@/features/input/composer/menus/BangRunsPanel';
import { ComposerPlusMenu } from '@/features/input/composer/menus/ComposerPlusMenu';
import { ModelPicker } from '@/features/input/composer/pickers/ModelPicker';
import { PlanApprovalBar } from './PlanApprovalBar';

const slots = {
  SlashPopup,
  AttachmentBar,
  MentionPicker,
  ContextUsage,
  ComposerTopBar,
  PermissionPicker,
  PromptPicker,
  EffortPicker,
  BangRunsPanel,
  ComposerPlusMenu,
  ModelPicker,
  PlanApprovalBar,
};

export function Composer() {
  const renderer = useRenderer();
  return <ComposerBinding view={renderer?.Composer ?? DefaultView} slots={slots} />;
}
