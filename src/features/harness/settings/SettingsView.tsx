import { useRenderer } from '@/logic/harness/renderer/RendererProvider';
import { SettingsBinding } from '@/logic/harness/settings/SettingsBinding';
import { SettingsView as DefaultView } from '@/render/harness/settings/SettingsView';
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
import { RemoteView as RemoteSection } from '@/features/connect/remote/RemoteView';
import { MemoryView as MemorySection } from '@/features/knowledge/memory/MemoryView';
import { AgentsView as AgentsSection } from '@/features/orchestration/agents/AgentsView';
import { PluginsPanel as PluginsSection } from '@/features/orchestration/collaboration/PluginsPanel';
import { McpManager as McpSection } from '@/features/orchestration/collaboration/McpManager';
import { SkillsView as SkillsSection } from '@/features/knowledge/skills/SkillsView';
import { HooksView as HooksSection } from '@/features/connect/hooks/HooksView';
import { UsageView as UsageSection } from '@/features/telemetry/usage/UsageView';

import { useNavigate } from '@tanstack/react-router';

const slots = { ConfigForm, DisplaySection, NotificationsSection, GroupsSection,
  PermissionRulesSection, ConfigInfoLine, SecurityScanCard, GuardStatsCard, ConfigHealthBanner, UpdatesSection,
  RemoteSection, MemorySection, AgentsSection, PluginsSection, McpSection, SkillsSection, HooksSection,
  UsageSection, PersonalizationSection };

export function SettingsView({ onClose }: { onClose?: () => void }) {
  const renderer = useRenderer();
  const navigate = useNavigate();
  // 覆盖层式挂载(SettingsHost)显式传 onClose;路由式挂载(/settings,经
  // 命令面板「前往设置」)不传 —— 缺省回首页,否则「返回工作台」按钮
  // onClick 为 undefined 永远无响应(实测 bug #4)。
  const close = onClose ?? (() => void navigate({ to: '/' }));
  return <SettingsBinding view={renderer?.SettingsView ?? DefaultView} slots={slots} onClose={close} />;
}
