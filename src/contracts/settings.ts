import type { ComponentType } from 'react';
import type { I18nContextValue } from '@/utils/i18n/context';
export type { UserApprovalPolicy } from '@/stores/agent/approvalPolicy';
import type { UserApprovalPolicy } from '@/stores/agent/approvalPolicy';

export type SettingsSection = 'provider' | 'groups' | 'permissions' | 'display' | 'notifications' | 'advanced';
export type SettingsPermissionMode = 'auto' | 'prompt' | 'deny' | 'plan' | 'accept_edits' | 'bubble' | 'bypass';

export interface SettingsSlots {
  ConfigInfoLine: ComponentType;
  ConfigForm: ComponentType<{ rawToml: string; onChange: (value: string) => void; showSecrets: Record<string, boolean>; onToggleSecret: (key: string) => void }>;
  /** 模型组页:统一管理内置端口 plan 与自定义 [[provider_group]]。 */
  GroupsSection: ComponentType<{ rawToml: string; onChange: (value: string) => void; onCommit: (value: string) => void }>;
  PermissionRulesSection: ComponentType;
  DisplaySection: ComponentType;
  NotificationsSection: ComponentType;
  ConfigHealthBanner: ComponentType;
  GuardStatsCard: ComponentType;
  SecurityScanCard: ComponentType;
  UpdatesSection: ComponentType;
}

export interface SettingsViewProps {
  t: I18nContextValue['t'];
  locale: I18nContextValue['locale'];
  onLocaleChange: I18nContextValue['setLocale'];
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  rawToml: string;
  onTomlChange: (value: string) => void;
  onCommit: (value: string) => void;
  showSecrets: Record<string, boolean>;
  onToggleSecret: (key: string) => void;
  approvalPolicy: UserApprovalPolicy;
  onApprovalPolicyChange: (value: UserApprovalPolicy) => void;
  status: { model: string; degraded_reason?: string | null; has_model: boolean } | undefined;
  loading: boolean;
  configLoading: boolean;
  saving: boolean;
  permissionPending: boolean;
  saved: boolean;
  error: string | null;
  onOpenPrompts: () => void;
  onPermission: (mode: SettingsPermissionMode) => void;
  onSave: () => void;
  onClose?: () => void;
  slots: SettingsSlots;
}
