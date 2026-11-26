import { useRenderer } from '@/logic/renderer/RendererProvider';
import { ComposerBinding } from '@/logic/composer/ComposerBinding';
import { Composer as DefaultView } from '@/render/input/composer/Composer';
import { SlashPopup } from './SlashPopup';
import { AttachmentBar } from './AttachmentBar';
import { MentionPicker } from './MentionPicker';
import { ContextUsage } from './ContextUsage';
import { ComposerTopBar } from './ComposerTopBar';
import { PermissionPicker } from './PermissionPicker';
import { PromptPicker } from './PromptPicker';
import { EffortPicker } from './EffortPicker';
import { BangRunsPanel } from './BangRunsPanel';
import { ComposerPlusMenu } from './ComposerPlusMenu';
import { ModelPicker } from './ModelPicker';
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
