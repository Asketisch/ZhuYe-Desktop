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
import { ConfigHealthBanner } from './ConfigHealthBanner';
import { UpdatesSection } from './sections/UpdatesSection';

const slots = { ConfigForm, DisplaySection, NotificationsSection, GroupsSection,
  PermissionRulesSection, ConfigInfoLine, SecurityScanCard, GuardStatsCard, ConfigHealthBanner, UpdatesSection };

export function SettingsView({ onClose }: { onClose?: () => void }) {
  const renderer = useRenderer();
  return <SettingsBinding view={renderer?.SettingsView ?? DefaultView} slots={slots} onClose={onClose} />;
}
