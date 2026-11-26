import type { I18nContextValue } from '@/utils/i18n/context';
export interface SideChannelRowInfo { id: string; agentName: string; prompt: string; startedAtMs?: number | null; status: 'running'|'done'|'cancelled'|'error'; durationMs?: number | null; }
export type SideChannelStatus = 'running'|'done'|'cancelled'|'error';

export type SideChannelStatusVariant = 'neutral' | 'accent' | 'success' | 'danger';

export interface SideChannelViewProps {
  t: I18nContextValue['t'];
  iconName: 'git-branch';
  title: string;
  subtitle: string;
  width: 'sm' | 'md' | 'lg';
  runningCount: number;
  loading: boolean;
  error: unknown;
  channels: SideChannelRowInfo[];
  showForm: boolean;
  agentName: string;
  prompt: string;
  isMutating: boolean;
  statusVariant: (status: SideChannelStatus) => SideChannelStatusVariant;
  onStartSubmit: () => void;
  onAgentNameChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onToggleForm: () => void;
  onCancel: (id: string) => void;
  labels: {
    runningCount: (count: number) => string;
    unavailable: string;
    start: string;
    cancel: string;
    agentNamePlaceholder: string;
    promptPlaceholder: string;
    startOne: string;
    failed: string;
    failedDesc: string;
    empty: string;
    emptyDesc: string;
  };
}
