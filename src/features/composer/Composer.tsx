import { useRenderer } from '@/logic/renderer/RendererProvider';
import { ComposerBinding } from '@/logic/composer/ComposerBinding';
import { Composer as DefaultView } from '@/render/composer/Composer';
import { SlashPopup } from './SlashPopup';
import { AttachmentBar } from './AttachmentBar';
import { MentionPicker } from './MentionPicker';
import { ContextUsage } from './ContextUsage';
import { ComposerTopBar } from './ComposerTopBar';
import { PermissionPicker } from './PermissionPicker';
import { EffortPicker } from './EffortPicker';
import { BangRunsPanel } from './BangRunsPanel';
import { ComposerPlusMenu } from './ComposerPlusMenu';
import { ModelPicker } from './ModelPicker';

const slots = {
  SlashPopup,
  AttachmentBar,
  MentionPicker,
  ContextUsage,
  ComposerTopBar,
  PermissionPicker,
  EffortPicker,
  BangRunsPanel,
  ComposerPlusMenu,
  ModelPicker,
};

export function Composer() {
  const renderer = useRenderer();
  return <ComposerBinding view={renderer?.Composer ?? DefaultView} slots={slots} />;
}
