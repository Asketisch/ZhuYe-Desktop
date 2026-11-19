import { useRenderer } from '@/logic/renderer/RendererProvider';
import { ComposerBinding } from '@/logic/composer/ComposerBinding';
import { Composer as DefaultView } from '@/render/composer/Composer';
import { SlashPopup } from './SlashPopup';
import { AttachmentBar } from './AttachmentBar';
import { MentionPicker } from './MentionPicker';
import { ContextUsage } from './ContextUsage';
import { ComposerControls } from './ComposerControls';
import { ComposerContextBar } from './ComposerContextBar';
import { BangRunsPanel } from './BangRunsPanel';

const slots = { SlashPopup, AttachmentBar, MentionPicker, ContextUsage, ComposerControls, ComposerContextBar, BangRunsPanel };

export function Composer() {
  const renderer = useRenderer();
  return <ComposerBinding view={renderer?.Composer ?? DefaultView} slots={slots} />;
}
