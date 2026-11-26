import type { ComponentType } from 'react';
import type { I18nContextValue } from '@/utils/i18n/context';
import type { SquadController } from '@/logic/orchestration/squad/useSquadController';
export type { SquadController } from '@/logic/orchestration/squad/useSquadController';
import type { ZhuyeSquadMember, ZhuyeTask } from '@/utils/commands';
export type { ZhuyeSquadMember, ZhuyeTask } from '@/utils/commands';

export interface SquadTaskRowProps {
  task: ZhuyeTask;
  members: ZhuyeSquadMember[];
  squadName: string;
  onAssign: (assignee: string | null) => Promise<void>;
}

export interface SquadViewProps {
  t: I18nContextValue['t'];
  tp: I18nContextValue['tp'];
  ctrl: SquadController;
  SquadTaskRow: ComponentType<SquadTaskRowProps>;
}
