import { useRenderView } from '@/logic/harness/renderer/useRenderView';
import { SquadBinding } from '@/logic/orchestration/squad/SquadBinding';
import { SquadView as DefaultView } from '@/render/orchestration/squad/SquadView';
import { SquadTaskRow } from './SquadTaskRow';

export function SquadView() {
  const View = useRenderView('SquadView', DefaultView);
  return <SquadBinding view={View} SquadTaskRow={SquadTaskRow} />;
}
