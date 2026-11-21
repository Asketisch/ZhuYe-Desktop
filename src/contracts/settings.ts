import type { ComponentType } from 'react';
import type { I18nContextValue } from '@/utils/i18n/context';
export type { UserApprovalPolicy } from '@/stores/agent/approvalPolicy';
import type { UserApprovalPolicy } from '@/stores/agent/approvalPolicy';

export type SettingsSection =
  | 'general'
  | 'appearance'
  | 'groups'
  | 'remote'
  | 'personalization'
  | 'behavior'
  | 'memory'
  | 'agents'
  | 'plugins'
  | 'mcp'
  | 'skills'
  | 'hooks'
  | 'usage'
  | 'advanced';
export type SettingsPermissionMode = 'auto' | 'prompt' | 'deny' | 'plan' | 'accept_edits' | 'bubble' | 'bypass';

/** 设置分区元信息（搜索弹层与分区导航共用）。 */
export interface SettingsSectionMeta {
  id: SettingsSection;
  labelKey: string;
  groupKey: string;
}

/** 分区搜索弹层状态（logic 层 useSettingsSearch 的产出，渲染层只消费）。 */
export interface SettingsSearchState {
  open: boolean;
  setOpen: (open: boolean) => void;
  query: string;
  setQuery: (query: string) => void;
  jump: (id: SettingsSection) => void;
}

export interface SettingsSlots {
  ConfigInfoLine: ComponentType;
  ConfigForm: ComponentType<{ rawToml: string; onChange: (value: string) => void; showSecrets: Record<string, boolean>; onToggleSecret: (key: string) => void }>;
  /** 模型组页:统一管理 [[model_group]] 模型组与其组内凭据池。
   *  status / loading = agent 状态徽标(模型接入就绪状态)。 */
  GroupsSection: ComponentType<{
    rawToml: string;
    onChange: (value: string) => void;
    onCommit: (value: string) => void;
    status?: { model: string; degraded_reason?: string | null; has_model: boolean };
    loading?: boolean;
  }>;
  PermissionRulesSection: ComponentType;
  DisplaySection: ComponentType;
  NotificationsSection: ComponentType;
  ConfigHealthBanner: ComponentType;
  GuardStatsCard: ComponentType;
  SecurityScanCard: ComponentType;
  UpdatesSection: ComponentType;
  /* —— 嵌入分区（路由页内容复用；标题由分区骨架统一出） —— */
  RemoteSection: ComponentType;
  MemorySection: ComponentType;
  AgentsSection: ComponentType;
  PluginsSection: ComponentType;
  McpSection: ComponentType;
  SkillsSection: ComponentType;
  HooksSection: ComponentType;
  UsageSection: ComponentType;
  /** 个性化：用户级自定义指令，读写落盘由分区内部负责。 */
  PersonalizationSection: ComponentType;
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
  /** 当前会话工作模式（三态归一，分段选中态真源）。 */
  permissionMode: string;
  saved: boolean;
  error: string | null;
  onOpenPrompts: () => void;
  onPermission: (mode: SettingsPermissionMode) => void;
  onSave: () => void;
  onClose?: () => void;
  /** 分区搜索弹层状态（⌘K；logic 层 useSettingsSearch 产出）。 */
  search: SettingsSearchState;
  slots: SettingsSlots;
}
