import { useRenderer } from '@/logic/renderer/RendererProvider';
import { SettingsBinding } from '@/logic/settings/SettingsBinding';
import { SettingsView as DefaultView } from '@/render/settings/SettingsView';
import { ConfigForm } from './ConfigForm';
import { DisplaySection } from './sections/DisplaySection';
import { NotificationsSection } from './sections/NotificationsSection';
import { GroupsSection } from './sections/GroupsSection';
import { PermissionRulesSection } from './sections/PermissionRulesSection';
import { ConfigInfoLine } from './sections/ConfigInfoLine';
import { SecurityScanCard } from './sections/SecurityScanCard';
import { GuardStatsCard } from './sections/GuardStatsCard';
import { PersonalizationSection } from './sections/PersonalizationSection';
import { ConfigHealthBanner } from './ConfigHealthBanner';
import { UpdatesSection } from './sections/UpdatesSection';
/* 嵌入分区：路由页内容复用（分区骨架统一出标题，页面壳由 CSS 折叠）。 */
import { RemoteView as RemoteSection } from '@/features/remote/RemoteView';
import { MemoryView as MemorySection } from '@/features/memory/MemoryView';
import { AgentsView as AgentsSection } from '@/features/agents/AgentsView';
import { PluginsPanel as PluginsSection } from '@/features/collaboration/PluginsPanel';
import { McpManager as McpSection } from '@/features/collaboration/McpManager';
import { SkillsView as SkillsSection } from '@/features/skills/SkillsView';
import { HooksView as HooksSection } from '@/features/hooks/HooksView';
import { UsageView as UsageSection } from '@/features/usage/UsageView';

const slots = { ConfigForm, DisplaySection, NotificationsSection, GroupsSection,
  PermissionRulesSection, ConfigInfoLine, SecurityScanCard, GuardStatsCard, ConfigHealthBanner, UpdatesSection,
  RemoteSection, MemorySection, AgentsSection, PluginsSection, McpSection, SkillsSection, HooksSection,
  UsageSection, PersonalizationSection };

export function SettingsView({ onClose }: { onClose?: () => void }) {
  const renderer = useRenderer();
  return <SettingsBinding view={renderer?.SettingsView ?? DefaultView} slots={slots} onClose={onClose} />;
}
