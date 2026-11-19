import type { I18nContextValue } from '@/utils/i18n/context';
export interface ScheduleJobView {
  id: string;
  schedule: string;
  prompt: string;
  name?: string | null;
  enabled: boolean;
  next_fire?: string | null;
}
export interface ScheduleStatusView {
  enabled: number;
  total: number;
  status: string;
}
export interface ScheduleViewProps {
  t: I18nContextValue['t'];
  status: ScheduleStatusView | null;
  showForm: boolean;
  onToggleForm: () => void;
  newSchedule: string;
  newPrompt: string;
  newName: string;
  onNewSchedule: (v: string) => void;
  onNewPrompt: (v: string) => void;
  onNewName: (v: string) => void;
  onSubmitCreate: () => void;
  loading: boolean;
  error: unknown;
  jobs: ScheduleJobView[];
  isMutating: boolean;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}
